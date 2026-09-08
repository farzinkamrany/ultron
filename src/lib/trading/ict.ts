/**
 * Smart Money Concepts (ICT) Engine
 * Left-Hemisphere: Focuses on Liquidity, Order Blocks, and Fair Value Gaps.
 */

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Finds untouched Fair Value Gaps (FVG / Imbalances) in the recent price action.
 * A Bullish FVG is when Candle 1 High < Candle 3 Low.
 * A Bearish FVG is when Candle 1 Low > Candle 3 High.
 */
export function findFairValueGaps(candles: OHLCV[]) {
  const fvgs = [];
  
  // We need at least 3 candles to form an FVG
  for (let i = 0; i < candles.length - 2; i++) {
    const c1 = candles[i];
    const c2 = candles[i + 1];
    const c3 = candles[i + 2];
    
    // Bullish FVG
    if (c1.high < c3.low) {
      fvgs.push({
        type: 'BULLISH_FVG',
        top: c3.low,
        bottom: c1.high,
        mitigated: false // In a real system, we'd check if future candles touched this gap
      });
    }
    
    // Bearish FVG
    if (c1.low > c3.high) {
      fvgs.push({
        type: 'BEARISH_FVG',
        top: c1.low,
        bottom: c3.high,
        mitigated: false
      });
    }
  }
  
  return fvgs;
}

/**
 * Finds Institutional Order Blocks (OB).
 * Bullish OB: The last down-close candle before an explosive up-move.
 * Bearish OB: The last up-close candle before an explosive down-move.
 */
export function findOrderBlocks(candles: OHLCV[]) {
  const orderBlocks = [];
  
  // Start from index 3 so we can check the previous 3 candles for a liquidity sweep
  for (let i = 3; i < candles.length - 1; i++) {
    const current = candles[i];
    const next = candles[i + 1];
    
    // Check if the current candle swept the liquidity of the previous 3 candles
    const prev3Lows = [candles[i-1].low, candles[i-2].low, candles[i-3].low];
    const prev3Highs = [candles[i-1].high, candles[i-2].high, candles[i-3].high];
    
    const sweptBearishLiquidity = current.low < Math.min(...prev3Lows);
    const sweptBullishLiquidity = current.high > Math.max(...prev3Highs);
    
    const isCurrentBearish = current.close < current.open;
    const isNextBullish = next.close > next.open;
    const nextBodySize = Math.abs(next.close - next.open);
    const currentBodySize = Math.abs(current.close - current.open);
    
    // Bullish Order Block (Red candle followed by massive Green candle engulfing it)
    if (isCurrentBearish && isNextBullish && nextBodySize > currentBodySize * 1.5) {
      let isMitigated = false;
      let isInvalidated = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].low <= current.high) isMitigated = true;
        if (candles[j].close < current.low) isInvalidated = true;
      }
      
      if (!isInvalidated) {
        orderBlocks.push({
          type: 'BULLISH_OB',
          top: current.high, // The mitigation entry point is usually the top or 50% of the OB
          bottom: current.low,
          sweptLiquidity: sweptBearishLiquidity,
          mitigated: isMitigated
        });
      }
    }
    
    // Bearish Order Block (Green candle followed by massive Red candle)
    const isCurrentBullish = current.close > current.open;
    const isNextBearish = next.close < next.open;
    
    if (isCurrentBullish && isNextBearish && nextBodySize > currentBodySize * 1.5) {
      let isMitigated = false;
      let isInvalidated = false;
      for (let j = i + 2; j < candles.length; j++) {
        if (candles[j].high >= current.low) isMitigated = true;
        if (candles[j].close > current.high) isInvalidated = true;
      }

      if (!isInvalidated) {
        orderBlocks.push({
          type: 'BEARISH_OB',
          top: current.high,
          bottom: current.low, // The mitigation entry point
          sweptLiquidity: sweptBullishLiquidity,
          mitigated: isMitigated
        });
      }
    }
  }
  
  return orderBlocks;
}
