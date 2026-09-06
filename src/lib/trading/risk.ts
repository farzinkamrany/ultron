import ccxt from 'ccxt';

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

export async function calculateDynamicKelly(symbol: string, winRate: number = 0.45, rr: number = 2.0): Promise<number> {
  const regime = await detectMarketRegime(symbol);
  
  // f = (bp - q) / b
  const p = winRate;
  const q = 1 - p;
  const b = rr;
  
  const kellyFraction = (b * p - q) / b;
  
  if (kellyFraction <= 0) return 0; // Negative expectancy, don't trade

  // In WILD markets, we use a Half-Kelly or Quarter-Kelly for defense
  // In CALM markets, we use a more aggressive Half-Kelly
  
  let riskPercentage = 0;
  if (regime === 'CALM') {
    riskPercentage = kellyFraction * 0.5; // Half-Kelly (Aggressive but mathematically safe)
  } else {
    riskPercentage = kellyFraction * 0.25; // Quarter-Kelly (Defensive)
  }

  // Cap maximum risk per trade at 5% to prevent blow-ups even with perfect Kelly
  return Math.min(riskPercentage, 0.05);
}
