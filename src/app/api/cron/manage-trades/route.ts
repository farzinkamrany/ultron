import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import ccxt from 'ccxt';
import { verifyQStashSignature } from '@/lib/qstash';
import { redis } from '@/lib/redis';
import { CTOConfig } from '@/lib/ai';
import { sendTelegramMessage } from '@/lib/telegram';

export const maxDuration = 60; // Allow 60s for Vercel execution to avoid 504 Timeout
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 0. Verify QStash signature for security (prevent DDoS/Rate Limit attacks)
    const isQStash = !!req.headers.get("upstash-signature");
    if (isQStash) {
      const isValid = await verifyQStashSignature(req);
      if (!isValid) {
        console.error("[Manage Trades] Invalid QStash signature");
        return new NextResponse("Unauthorized", { status: 401 });
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error("[Manage Trades] Direct access blocked. Must use QStash.");
      return new NextResponse("Unauthorized", { status: 401 });
    }
    // 1. Fetch CTO Config
    let ctoConfig: CTOConfig | null = null;
    try {
      const configStr = await redis.get('ul_cto_config') as string | null;
      if (configStr) ctoConfig = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
    } catch (err) {
      console.error("Redis fetch failed, using fallback config.");
    }
    const defconLevel = ctoConfig?.defcon_level || 0;

    // 2. Fetch all OPEN paper trades
    const { data: openTrades, error: fetchError } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('status', 'OPEN');

    if (fetchError) throw fetchError;
    if (!openTrades || openTrades.length === 0) {
      return NextResponse.json({ message: 'No open trades to manage' });
    }

    const exchange = new ccxt.bybit({ enableRateLimit: true, options: { defaultType: 'spot' } });
    
    // Group by symbol to batch ticker fetch
    const symbols = [...new Set(openTrades.map(t => t.symbol))];
    const tickers = await exchange.fetchTickers(symbols);

    const FEE_RATE = 0.0012; // 0.12% offset to cover Bybit Taker Fee + Slippage
    const updates = [];
    const newTradesToInsert: any[] = [];

    for (const trade of openTrades) {
      const ticker = tickers[trade.symbol];
      if (!ticker || !ticker.last) continue;

      const currentPrice = ticker.last;
      let newStatus = trade.status;
      let newStopLoss = trade.stop_loss;
      let newTakeProfit = trade.take_profit;
      let newRationale = trade.rationale || '';
      let pnl = 0;
      let closedAt = null;

      // 2. Check PnL and hit triggers
      if (trade.position_type === 'LONG') {
        if (currentPrice <= trade.stop_loss) {
          newStatus = trade.stop_loss > trade.entry_price ? 'WON' : 'LOST';
          pnl = trade.stop_loss > trade.entry_price 
                ? currentPrice - trade.entry_price 
                : -Math.abs(trade.entry_price - trade.stop_loss);
          closedAt = new Date().toISOString();
        } else {
          const distanceToTp = trade.take_profit - trade.entry_price;
          const currentProfit = currentPrice - trade.entry_price;
          const profitPerc = currentProfit / distanceToTp;
          
          // Stage 1: 50% Mark
          if (profitPerc >= 0.5 && profitPerc < 0.75 && trade.stop_loss < trade.entry_price) {
            newStopLoss = trade.entry_price * (1 + FEE_RATE);
            if (defconLevel === 0 && !newRationale.includes('T1')) {
              newRationale += ' | Pyramid T1';
              newTradesToInsert.push({
                symbol: trade.symbol, position_type: 'LONG', entry_price: currentPrice,
                take_profit: trade.take_profit, stop_loss: newStopLoss, status: 'OPEN', rationale: 'Pyramid T1 Scale-In'
              });
            }
          }
          // Stage 2: 75% Mark
          else if (profitPerc >= 0.75 && profitPerc < 1.0 && trade.stop_loss < trade.entry_price + (distanceToTp * 0.5)) {
            newStopLoss = trade.entry_price + (distanceToTp * 0.5);
            if (defconLevel === 0 && !newRationale.includes('T2')) {
              newRationale += ' | Pyramid T2';
              newTradesToInsert.push({
                symbol: trade.symbol, position_type: 'LONG', entry_price: currentPrice,
                take_profit: trade.take_profit, stop_loss: newStopLoss, status: 'OPEN', rationale: 'Pyramid T2 Scale-In'
              });
            }
          }
          // Stage 3: 100% Mark (TP Extension)
          else if (currentPrice >= trade.take_profit) {
            if (defconLevel === 0) {
              newStopLoss = trade.take_profit - (distanceToTp * 0.2);
              newTakeProfit = trade.take_profit + distanceToTp;
              newTradesToInsert.push({
                symbol: trade.symbol, position_type: 'LONG', entry_price: currentPrice,
                take_profit: newTakeProfit, stop_loss: newStopLoss, status: 'OPEN', rationale: 'Pyramid T3 (Extended)'
              });
            } else {
              newStatus = 'WON';
              pnl = currentPrice - trade.entry_price;
              closedAt = new Date().toISOString();
            }
          }
        }
      } else {
        // SHORT Logic
        if (currentPrice >= trade.stop_loss) {
          newStatus = trade.stop_loss < trade.entry_price ? 'WON' : 'LOST';
          pnl = trade.stop_loss < trade.entry_price
                ? trade.entry_price - currentPrice
                : -Math.abs(trade.stop_loss - trade.entry_price);
          closedAt = new Date().toISOString();
        } else {
          const distanceToTp = trade.entry_price - trade.take_profit;
          const currentProfit = trade.entry_price - currentPrice;
          const profitPerc = currentProfit / distanceToTp;

          // Stage 1: 50% Mark
          if (profitPerc >= 0.5 && profitPerc < 0.75 && trade.stop_loss > trade.entry_price) {
            newStopLoss = trade.entry_price * (1 - FEE_RATE);
            if (defconLevel === 0 && !newRationale.includes('T1')) {
              newRationale += ' | Pyramid T1';
              newTradesToInsert.push({
                symbol: trade.symbol, position_type: 'SHORT', entry_price: currentPrice,
                take_profit: trade.take_profit, stop_loss: newStopLoss, status: 'OPEN', rationale: 'Pyramid T1 Scale-In'
              });
            }
          }
          // Stage 2: 75% Mark
          else if (profitPerc >= 0.75 && profitPerc < 1.0 && trade.stop_loss > trade.entry_price - (distanceToTp * 0.5)) {
            newStopLoss = trade.entry_price - (distanceToTp * 0.5);
            if (defconLevel === 0 && !newRationale.includes('T2')) {
              newRationale += ' | Pyramid T2';
              newTradesToInsert.push({
                symbol: trade.symbol, position_type: 'SHORT', entry_price: currentPrice,
                take_profit: trade.take_profit, stop_loss: newStopLoss, status: 'OPEN', rationale: 'Pyramid T2 Scale-In'
              });
            }
          }
          // Stage 3: 100% Mark (TP Extension)
          else if (currentPrice <= trade.take_profit) {
            if (defconLevel === 0) {
              newStopLoss = trade.take_profit + (distanceToTp * 0.2);
              newTakeProfit = trade.take_profit - distanceToTp;
              newTradesToInsert.push({
                symbol: trade.symbol, position_type: 'SHORT', entry_price: currentPrice,
                take_profit: newTakeProfit, stop_loss: newStopLoss, status: 'OPEN', rationale: 'Pyramid T3 (Extended)'
              });
            } else {
              newStatus = 'WON';
              pnl = trade.entry_price - currentPrice;
              closedAt = new Date().toISOString();
            }
          }
        }
      }

      // 4. Update the DB
      if (newStatus !== trade.status || newStopLoss !== trade.stop_loss || newTakeProfit !== trade.take_profit || newRationale !== trade.rationale) {
        updates.push(
          supabase
            .from('paper_trades')
            .update({
              status: newStatus,
              stop_loss: newStopLoss,
              take_profit: newTakeProfit,
              rationale: newRationale,
              pnl: pnl,
              closed_at: closedAt
            })
            .eq('id', trade.id)
        );
      }
    }

    await Promise.all(updates);
    
    if (newTradesToInsert.length > 0) {
      const { error: insertError } = await supabase.from('paper_trades').insert(newTradesToInsert);
      if (insertError) {
        console.error("[Manage Trades] Failed to insert Pyramiding trades:", insertError);
      } else {
        const chatId = process.env.TELEGRAM_CHAT_ID;
        if (chatId) {
          const msg = `🔥 **هرم‌سازی تهاجمی (Anti-Martingale)** 🔥\n\n` + 
            `سیستم وارد فاز هرم‌سازی شد و پوزیشن جدیدی باز کرد!\n` +
            `تعداد پوزیشن‌های هرمیِ باز شده: ${newTradesToInsert.length}\n` +
            `سیستم تمام ریسک این پوزیشن‌ها را صفر کرد و در حالِ بلعیدنِ روند است! 🚀`;
          await sendTelegramMessage(chatId, msg);
        }
      }
    }

    return NextResponse.json({ 
      message: `Managed ${openTrades.length} trades. Updated ${updates.length}. Pyramided ${newTradesToInsert.length}.` 
    });
  } catch (error: any) {
    console.error('[Manage Trades Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
