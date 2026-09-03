import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import ccxt from 'ccxt';
import { verifyQStashSignature } from '@/lib/qstash';
import { redis } from '@/lib/redis';
import { CTOConfig } from '@/lib/ai';

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
      let pnl = 0;
      let closedAt = null;

      let newTakeProfit = trade.take_profit;

      // 2. Check PnL and hit triggers
      if (trade.position_type === 'LONG') {
        if (currentPrice <= trade.stop_loss) {
          // If we hit stop loss, check if it's the original SL or a trailing SL in profit
          newStatus = trade.stop_loss > trade.entry_price ? 'WON' : 'LOST';
          pnl = trade.stop_loss > trade.entry_price 
                ? currentPrice - trade.entry_price 
                : -Math.abs(trade.entry_price - trade.stop_loss);
          closedAt = new Date().toISOString();
        } else if (currentPrice >= trade.take_profit) {
          // Asymmetric Runner + Pyramiding: Extend TP, lock in SL, open new trade
          const distance = trade.take_profit - trade.entry_price;
          newStopLoss = trade.take_profit - (distance * 0.2); // Lock in 80% of the target's profit
          newTakeProfit = trade.take_profit + distance; // Extend target
          
          console.log(`[Manage Trades] LONG Runner extended! New SL: ${newStopLoss}, New TP: ${newTakeProfit}`);
          
          // Pyramid Scale-In (Blocked if DEFCON > 0)
          if (defconLevel === 0) {
            newTradesToInsert.push({
              symbol: trade.symbol,
              position_type: 'LONG',
              entry_price: currentPrice,
              take_profit: newTakeProfit,
              stop_loss: newStopLoss,
              status: 'OPEN',
              rationale: 'Pyramid Scale-In (Risk-Free)'
            });
          } else {
            console.log(`[Manage Trades] Pyramiding blocked due to DEFCON ${defconLevel}`);
          }

        } else {
          // 3. Trailing Stop Logic (True Break-Even)
          const distanceToTp = trade.take_profit - trade.entry_price;
          const currentProfit = currentPrice - trade.entry_price;
          
          if (currentProfit >= distanceToTp * 0.5 && trade.stop_loss < trade.entry_price) {
            newStopLoss = trade.entry_price * (1 + FEE_RATE); // Move to True Break-Even (Cover Fees)
            console.log(`[Manage Trades] True Break-Even activated for ${trade.symbol}`);
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
        } else if (currentPrice <= trade.take_profit) {
          // Asymmetric Runner + Pyramiding
          const distance = trade.entry_price - trade.take_profit;
          newStopLoss = trade.take_profit + (distance * 0.2); // Lock in 80% of the target's profit
          newTakeProfit = trade.take_profit - distance; // Extend target downward
          
          console.log(`[Manage Trades] SHORT Runner extended! New SL: ${newStopLoss}, New TP: ${newTakeProfit}`);

          // Pyramid Scale-In (Blocked if DEFCON > 0)
          if (defconLevel === 0) {
            newTradesToInsert.push({
              symbol: trade.symbol,
              position_type: 'SHORT',
              entry_price: currentPrice,
              take_profit: newTakeProfit,
              stop_loss: newStopLoss,
              status: 'OPEN',
              rationale: 'Pyramid Scale-In (Risk-Free)'
            });
          } else {
            console.log(`[Manage Trades] Pyramiding blocked due to DEFCON ${defconLevel}`);
          }

        } else {
          // Trailing Stop Logic (True Break-Even)
          const distanceToTp = trade.entry_price - trade.take_profit;
          const currentProfit = trade.entry_price - currentPrice;
          
          if (currentProfit >= distanceToTp * 0.5 && trade.stop_loss > trade.entry_price) {
            newStopLoss = trade.entry_price * (1 - FEE_RATE); // Move to True Break-Even (Cover Fees)
            console.log(`[Manage Trades] True Break-Even activated for ${trade.symbol}`);
          }
        }
      }

      // 4. Update the DB
      if (newStatus !== trade.status || newStopLoss !== trade.stop_loss || newTakeProfit !== trade.take_profit) {
        updates.push(
          supabase
            .from('paper_trades')
            .update({
              status: newStatus,
              stop_loss: newStopLoss,
              take_profit: newTakeProfit,
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
      if (insertError) console.error("[Manage Trades] Failed to insert Pyramiding trades:", insertError);
    }

    return NextResponse.json({ 
      message: `Managed ${openTrades.length} trades. Updated ${updates.length}. Pyramided ${newTradesToInsert.length}.` 
    });
  } catch (error: any) {
    console.error('[Manage Trades Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
