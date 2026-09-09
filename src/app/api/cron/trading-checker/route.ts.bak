import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import ccxt from "ccxt";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import { verifyQStashSignature } from "@/lib/qstash";
import { closeMicroPosition, buildHyperliquid } from "@/lib/trading/executor";

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

    if (dbError) throw new Error(dbError.message || JSON.stringify(dbError));
    if (!openTrades || openTrades.length === 0) {
      return NextResponse.json({ ok: true, message: "No open trades to check" });
    }

    // 2. Init Exchange to fetch live prices
    const exchange = new ccxt.bybit({ 
      enableRateLimit: true
    });

    // Map unique symbols to fetch minimal tickers (convert BTCUSDT to BTC/USDT for CCXT)
    const symbols = [...new Set(openTrades.map(t => t.symbol.includes('/') ? t.symbol : t.symbol.replace('USDT', '/USDT')))];
    
    // We can fetch tickers for all needed symbols
    let tickers: any = {};
    if (symbols.length > 0) {
      tickers = await exchange.fetchTickers(symbols);
    }

    let resolvedCount = 0;

    for (const trade of openTrades) {
      const ccxtSymbol = trade.symbol.includes('/') ? trade.symbol : trade.symbol.replace('USDT', '/USDT');
      const ticker = tickers[ccxtSymbol];
      if (!ticker) continue;
      
      const currentPrice = ticker.last;
      let newStatus = 'OPEN';
      let pnl = 0;

      // Check LONG positions
      if (trade.position_type === 'BUY') {
        if (currentPrice >= trade.take_profit) {
          newStatus = 'WON';
        } else if (currentPrice <= trade.stop_loss) {
          newStatus = 'LOST';
        }
      } 
      // Check SHORT positions
      else if (trade.position_type === 'SELL') {
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
        if (trade.position_type === 'BUY') {
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

        // If in MICRO mode, also close the actual position on the exchange
        if (process.env.TRADE_MODE === "MICRO") {
          await closeMicroPosition(trade.symbol, trade.position_type as "BUY" | "SELL");
        }

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

    // 3. Cleanup Stale Limit Orders (Hyperliquid MICRO Mode)
    if (process.env.TRADE_MODE === "MICRO") {
        try {
            const hl = buildHyperliquid();
            await hl.loadMarkets();
            const allOrders = await hl.fetchOpenOrders();
            const now = Date.now();
            for (const order of allOrders) {
                // If it's a normal entry limit order (not a trigger/stop order) and older than 15 mins
                if (order.type === 'limit' && order.timestamp && (now - order.timestamp > 15 * 60 * 1000)) {
                    await hl.cancelOrder(order.id, order.symbol);
                    console.log(`[Limit Cleanup] Cancelled stale limit order ${order.id} for ${order.symbol}`);
                }
            }
        } catch (e: any) {
            console.error(`[Limit Cleanup Error] ${e.message}`);
        }
    }

    return NextResponse.json({ 
      ok: true, 
      open_checked: openTrades.length,
      resolved: resolvedCount 
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    const stackTrace = error instanceof Error ? error.stack : null;
    
    // Log directly to Supabase
    try {
      await supabase.from("system_logs").insert([{
        level: "CRITICAL",
        context: "API_TRADING_CHECKER",
        message: errorMessage,
        stack_trace: stackTrace
      }]);
    } catch (e) {
      console.error("Failed to write to system_logs:", e);
    }

    // Send Telegram Alert
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (chatId) {
      const alertMsg = `🚨 <b>SYSTEM DEGRADED</b>\n\n<b>Context:</b> API_TRADING_CHECKER\n<b>Error:</b> ${errorMessage}\n\n<i>Check Supabase system_logs for stack trace.</i>`;
      await sendTelegramMessage(chatId, alertMsg);
    }
    
    return NextResponse.json({ error: "Trading checker failed", details: errorMessage }, { status: 500 });
  }
}
