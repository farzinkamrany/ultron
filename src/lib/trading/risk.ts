import ccxt from 'ccxt';
import { supabase } from '../supabase';

// Analyzes 14-day ATR to detect if the market is wild/volatile or calm/trending
export async function detectMarketRegime(symbol: string): Promise<'WILD' | 'CALM'> {
  try {
    const exchange = new ccxt.bybit({ enableRateLimit: true, options: { defaultType: 'spot' } });
    // Fetch 15 days to calculate 14-day ATR properly (need previous close)
    const ohlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 15);

    if (ohlcv.length < 15) return 'WILD'; // Default to safe mode

    let totalTR = 0;
    const trueRanges: number[] = [];

    for (let i = 1; i < ohlcv.length; i++) {
      const high = ohlcv[i][2] as number;
      const low = ohlcv[i][3] as number;
      const prevClose = ohlcv[i - 1][4] as number;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
      totalTR += tr;
    }

    const currentATR = totalTR / 14;

    // Compare the last 3 days ATR to the 14-day ATR
    const recentTR = (trueRanges[11] + trueRanges[12] + trueRanges[13]) / 3;

    // If recent volatility is 20% higher than the 14-day average, it's wild
    return recentTR > (currentATR * 1.2) ? 'WILD' : 'CALM';
  } catch (error) {
    console.error("Regime Detection Failed:", error);
    return 'WILD'; // Default to defensive mode
  }
}

export async function getAccountDrawdown(): Promise<number> {
  const { data: allTrades } = await supabase.from('paper_trades').select('pnl').not('pnl', 'is', null);
  let currentBalance = 1000;
  let peakBalance = 1000;
  if (allTrades) {
    for (const t of allTrades) {
      currentBalance += (t.pnl || 0);
      if (currentBalance > peakBalance) peakBalance = currentBalance;
    }
  }
  return peakBalance > 0 ? (peakBalance - currentBalance) / peakBalance : 0;
}

// --- SELF-CALIBRATING ENGINE ---
// Reads real win rate and R:R from closed trade history.
// Falls back to conservative defaults until at least 30 trades are available.
const MIN_TRADES_FOR_CALIBRATION = 30;

async function getRealEdge(): Promise<{ winRate: number; rr: number; tradeCount: number }> {
  try {
    const { data: closedTrades } = await supabase
      .from('paper_trades')
      .select('status, entry_price, take_profit, stop_loss')
      .in('status', ['WON', 'LOST']);

    if (!closedTrades || closedTrades.length < MIN_TRADES_FOR_CALIBRATION) {
      console.log(`[Kelly] Not enough trades for calibration (${closedTrades?.length || 0}/${MIN_TRADES_FOR_CALIBRATION}). Using defaults.`);
      return { winRate: 0.45, rr: 2.0, tradeCount: closedTrades?.length || 0 };
    }

    const wins = closedTrades.filter(t => t.status === 'WON').length;
    const realWinRate = wins / closedTrades.length;

    // Calculate average R:R from actual TP/SL distances
    const rrValues = closedTrades
      .map(t => {
        const tpDist = Math.abs(t.take_profit - t.entry_price);
        const slDist = Math.abs(t.stop_loss - t.entry_price);
        return slDist > 0 ? tpDist / slDist : 0;
      })
      .filter(v => v > 0);

    const realRR = rrValues.length > 0
      ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length
      : 2.0;

    console.log(`[Kelly] Calibrated from ${closedTrades.length} trades → Win Rate: ${(realWinRate * 100).toFixed(1)}%, Avg R:R: ${realRR.toFixed(2)}`);
    return { winRate: realWinRate, rr: realRR, tradeCount: closedTrades.length };

  } catch (err) {
    console.error('[Kelly] Calibration fetch failed, using defaults.', err);
    return { winRate: 0.45, rr: 2.0, tradeCount: 0 };
  }
}

export async function calculateDynamicKelly(symbol: string): Promise<number> {
  const regime = await detectMarketRegime(symbol);
  const { winRate, rr } = await getRealEdge();

  // f = (bp - q) / b
  const p = winRate;
  const q = 1 - p;
  const b = rr;

  const kellyFraction = (b * p - q) / b;

  if (kellyFraction <= 0) {
    console.warn(`[Kelly] Negative expectancy detected (WR=${(p*100).toFixed(1)}%, RR=${b.toFixed(2)}). Skipping trade.`);
    return 0; // Negative expectancy → don't trade
  }

  const baseRiskPercentage = 0.015; // Hard cap: Max 1.5% risk per trade

  // Quarter-Kelly for long-term compounding stability
  const finalRisk = kellyFraction * 0.25;

  // Wild market: cut risk in half
  const regimeMultiplier = regime === 'WILD' ? 0.5 : 1.0;

  return Math.min(finalRisk * regimeMultiplier, baseRiskPercentage);
}
