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

export async function calculateDynamicKelly(symbol: string, winRate: number = 0.45, rr: number = 2.0): Promise<number> {
  const regime = await detectMarketRegime(symbol);
  const drawdownPerc = await getAccountDrawdown();

  // f = (bp - q) / b
  const p = winRate;
  const q = 1 - p;
  const b = rr;

  const kellyFraction = (b * p - q) / b;

  if (kellyFraction <= 0) return 0; // Negative expectancy, don't trade

  // --- THE SHIELD PROTOCOL: Dynamic Drawdown Scaling (V14.0) ---
  // Base Risk Cap is 1.5%
  let riskPercentage = 0.015;
  
  if (drawdownPerc >= 0.20) {
    riskPercentage = 0.0035; // 20% in drawdown -> Risk capped at 0.35%
  } else if (drawdownPerc >= 0.10) {
    riskPercentage = 0.0075; // 10% in drawdown -> Risk capped at 0.75%
  }

  // Calculate Kelly but never exceed the riskPercentage cap
  let finalRisk = 0;
  if (regime === 'CALM') {
    finalRisk = kellyFraction * 0.5; // Half-Kelly
  } else {
    finalRisk = kellyFraction * 0.25; // Quarter-Kelly
  }

  // Enforce V14.0 Base Risk Limits
  return Math.min(finalRisk, riskPercentage);
}
