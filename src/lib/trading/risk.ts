import ccxt from 'ccxt';

// Simulates ATR/ADX to detect regime
export async function detectMarketRegime(symbol: string): Promise<'TRENDING' | 'RANGING'> {
  try {
    const exchange = new ccxt.bybit({ enableRateLimit: true, options: { defaultType: 'spot' } });
    const ohlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 14);
    
    // Very basic volatility proxy: Compare recent body size to wicks
    let totalRange = 0;
    let totalBody = 0;
    
    for (const candle of ohlcv) {
      const open = candle[1] as number;
      const high = candle[2] as number;
      const low = candle[3] as number;
      const close = candle[4] as number;
      
      totalRange += (high - low);
      totalBody += Math.abs(close - open);
    }
    
    const bodyRatio = totalRange === 0 ? 0 : totalBody / totalRange;
    
    // If bodies make up > 40% of range, it's trending. Otherwise ranging/choppy.
    return bodyRatio > 0.4 ? 'TRENDING' : 'RANGING';
  } catch (error) {
    console.error("Regime Detection Failed:", error);
    return 'RANGING'; // Default to safe mode
  }
}

export async function calculateDynamicKelly(symbol: string): Promise<number> {
  const regime = await detectMarketRegime(symbol);
  
  if (regime === 'TRENDING') {
    return 0.03; // 3% Risk
  } else {
    return 0.005; // 0.5% Risk
  }
}
