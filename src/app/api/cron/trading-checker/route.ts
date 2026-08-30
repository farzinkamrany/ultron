import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import ccxt from "ccxt";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import { HttpsProxyAgent } from "https-proxy-agent";
import { verifyQStashSignature } from "@/lib/qstash";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    return new NextResponse('Unauthorized: Invalid QStash Signature', { status: 401 });
  }

  try {
    // 1. Fetch all OPEN paper trades
    const { data: openTrades, error: dbError } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('status', 'OPEN');

    if (dbError) throw dbError;
    if (!openTrades || openTrades.length === 0) {
      return NextResponse.json({ ok: true, message: "No open trades to check" });
    }

    // 2. Init Exchange to fetch live prices
    const exchange = new ccxt.binance({ enableRateLimit: true });
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) {
      exchange.agent = new HttpsProxyAgent(proxyUrl);
    }

    // Map unique symbols to fetch minimal tickers
    const symbols = [...new Set(openTrades.map(t => t.symbol.replace('', '')))];
    
    // We can fetch tickers for all needed symbols
    let tickers: any = {};
    if (symbols.length > 0) {
      tickers = await exchange.fetchTickers(symbols);
    }

    let resolvedCount = 0;

    for (const trade of openTrades) {
      const ticker = tickers[trade.symbol];
      if (!ticker) continue;
      
      const currentPrice = ticker.last;
      let newStatus = 'OPEN';
      let pnl = 0;

      // Check LONG positions
      if (trade.position_type === 'LONG') {
        if (currentPrice >= trade.take_profit) {
          newStatus = 'WON';
        } else if (currentPrice <= trade.stop_loss) {
          newStatus = 'LOST';
        }
      } 
      // Check SHORT positions
      else if (trade.position_type === 'SHORT') {
        if (currentPrice <= trade.take_profit) {
          newStatus = 'WON';
        } else if (currentPrice >= trade.stop_loss) {
          newStatus = 'LOST';
        }
      }

      if (newStatus !== 'OPEN') {
        // Calculate PnL assuming $1000 margin without leverage
        const margin = 1000;
        const entryPrice = parseFloat(trade.entry_price);
        const exitPrice = currentPrice;
        
        let percentageChange = 0;
        if (trade.position_type === 'LONG') {
          percentageChange = (exitPrice - entryPrice) / entryPrice;
        } else {
          percentageChange = (entryPrice - exitPrice) / entryPrice;
        }
        
        pnl = margin * percentageChange;

        // Update trade in DB
        await supabase.from('paper_trades').update({
          status: newStatus,
          pnl: parseFloat(pnl.toFixed(2)),
          closed_at: new Date().toISOString()
        }).eq('id', trade.id);

        resolvedCount++;

        // Send Alert
        const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (chatId) {
          const emoji = newStatus === 'WON' ? '✅' : '❌';
          const msg = `${emoji} <b>PAPER TRADE CLOSED (${newStatus})</b> ${emoji}\n\n` +
                      `<b>Asset:</b> ${trade.symbol}\n` +
                      `<b>Type:</b> ${trade.position_type}\n` +
                      `<b>Entry:</b> $${entryPrice}\n` +
                      `<b>Exit:</b> $${exitPrice}\n` +
                      `<b>PnL:</b> $${pnl.toFixed(2)} (on $1000 margin)`;
          await sendTelegramMessage(chatId, msg);
        }
      }
    }

    return NextResponse.json({ 
      ok: true, 
      open_checked: openTrades.length,
      resolved: resolvedCount 
    });
  } catch (error: any) {
    await logError("API_TRADING_CHECKER", error, {}, true);
    return NextResponse.json({ error: "Trading checker failed" }, { status: 500 });
  }
}
