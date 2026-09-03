import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import ccxt from 'ccxt';

export async function GET() {
  try {
    // 1. Fetch all OPEN paper trades
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

    const updates = [];

    for (const trade of openTrades) {
      const ticker = tickers[trade.symbol];
      if (!ticker || !ticker.last) continue;

      const currentPrice = ticker.last;
      let newStatus = trade.status;
      let newStopLoss = trade.stop_loss;
      let pnl = 0;
      let closedAt = null;

      // 2. Check PnL and hit triggers
      if (trade.position_type === 'LONG') {
        if (currentPrice <= trade.stop_loss) {
          newStatus = 'LOST';
          pnl = -Math.abs(trade.entry_price - trade.stop_loss); // Mock PnL unit
          closedAt = new Date().toISOString();
        } else if (currentPrice >= trade.take_profit) {
          newStatus = 'WON';
          pnl = Math.abs(trade.take_profit - trade.entry_price);
          closedAt = new Date().toISOString();
        } else {
          // 3. Trailing Stop Logic (SMC Break-Even)
          // If price moved 50% towards Take Profit, move Stop Loss to Entry
          const distanceToTp = trade.take_profit - trade.entry_price;
          const currentProfit = currentPrice - trade.entry_price;
          
          if (currentProfit >= distanceToTp * 0.5 && trade.stop_loss < trade.entry_price) {
            newStopLoss = trade.entry_price; // Move to Break-Even
            console.log(`[Manage Trades] Trailing Stop activated for ${trade.symbol}`);
          }
        }
      } else {
        // SHORT Logic
        if (currentPrice >= trade.stop_loss) {
          newStatus = 'LOST';
          pnl = -Math.abs(trade.stop_loss - trade.entry_price);
          closedAt = new Date().toISOString();
        } else if (currentPrice <= trade.take_profit) {
          newStatus = 'WON';
          pnl = Math.abs(trade.entry_price - trade.take_profit);
          closedAt = new Date().toISOString();
        } else {
          // Trailing Stop Logic
          const distanceToTp = trade.entry_price - trade.take_profit;
          const currentProfit = trade.entry_price - currentPrice;
          
          if (currentProfit >= distanceToTp * 0.5 && trade.stop_loss > trade.entry_price) {
            newStopLoss = trade.entry_price; // Move to Break-Even
            console.log(`[Manage Trades] Trailing Stop activated for ${trade.symbol}`);
          }
        }
      }

      // 4. Update the DB
      if (newStatus !== trade.status || newStopLoss !== trade.stop_loss) {
        updates.push(
          supabase
            .from('paper_trades')
            .update({
              status: newStatus,
              stop_loss: newStopLoss,
              pnl: pnl,
              closed_at: closedAt
            })
            .eq('id', trade.id)
        );
      }
    }

    await Promise.all(updates);

    return NextResponse.json({ message: `Managed ${openTrades.length} trades. Updated ${updates.length}.` });
  } catch (error: any) {
    console.error('[Manage Trades Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
