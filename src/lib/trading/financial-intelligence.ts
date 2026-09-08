export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function detectSqueeze(candles: Candle[], lookback: number = 20): boolean {
  if (candles.length < lookback) return false;
  const periodCandles = candles.slice(-lookback);
  const currentClose = candles[candles.length - 1].close;
  
  // Calculate Bollinger Bands
  const sum = periodCandles.reduce((a, b) => a + b.close, 0);
  const sma = sum / lookback;
  
  let variance = 0;
  for (const c of periodCandles) {
    variance += Math.pow(c.close - sma, 2);
  }
  const stdDev = Math.sqrt(variance / lookback);
  const upperBB = sma + (stdDev * 2);
  const lowerBB = sma - (stdDev * 2);
  
  // Calculate Keltner Channels
  let trSum = 0;
  for (let i = candles.length - lookback; i < candles.length; i++) {
     const high = candles[i].high;
     const low = candles[i].low;
     const prevClose = candles[i-1].close;
     trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  const atr = trSum / lookback;
  const upperKC = sma + (atr * 1.5);
  const lowerKC = sma - (atr * 1.5);
  
  // Squeeze condition: BB is inside KC
  return (upperBB < upperKC && lowerBB > lowerKC);
}

export function calculateChoppinessIndex(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50;
  
  let atrSum = 0;
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i-1].close;
    
    if (high > highestHigh) highestHigh = high;
    if (low < lowestLow) lowestLow = low;
    
    atrSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  
  if (highestHigh - lowestLow === 0) return 50;
  
  const ci = 100 * Math.log10(atrSum / (highestHigh - lowestLow)) / Math.log10(period);
  return ci;
}

export function calculateRollingVWAP(candles: Candle[], period: number = 14): number {
  if (candles.length < period) return candles[candles.length - 1].close;
  
  let typicalPriceVolSum = 0;
  let volSum = 0;
  
  for (let i = candles.length - period; i < candles.length; i++) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const vol = candles[i].volume;
    typicalPriceVolSum += tp * vol;
    volSum += vol;
  }
  
  if (volSum === 0) return candles[candles.length - 1].close;
  return typicalPriceVolSum / volSum;
}

export function calculateVolumeProfile(candles: Candle[], lookback: number = 200, bins: number = 50): number {
    if (candles.length < lookback) return candles[candles.length - 1].close;
    
    const slice = candles.slice(-lookback);
    let min = Infinity;
    let max = -Infinity;
    
    for (const c of slice) {
        if (c.low < min) min = c.low;
        if (c.high > max) max = c.high;
    }
    
    const binSize = (max - min) / bins;
    const profile = new Array(bins).fill(0);
    
    for (const c of slice) {
        const tp = (c.high + c.low + c.close) / 3;
        const binIndex = Math.min(bins - 1, Math.floor((tp - min) / binSize));
        profile[binIndex] += c.volume;
    }
    
    let maxVol = 0;
    let pocIndex = 0;
    for (let i = 0; i < bins; i++) {
        if (profile[i] > maxVol) {
            maxVol = profile[i];
            pocIndex = i;
        }
    }
    
    return min + (pocIndex * binSize) + (binSize / 2);
}

export function detectLiquiditySweep(candles: Candle[], lookback: number = 50): { type: 'BULLISH' | 'BEARISH' } | null {
  if (candles.length < lookback + 1) return null;
  
  const current = candles[candles.length - 1];
  
  let swingLow = Infinity;
  let swingHigh = -Infinity;
  
  for (let i = candles.length - lookback; i < candles.length - 1; i++) {
    if (candles[i].low < swingLow) swingLow = candles[i].low;
    if (candles[i].high > swingHigh) swingHigh = candles[i].high;
  }
  
  // Bullish Sweep: Price goes below recent swing low but closes above it
  if (current.low < swingLow && current.close > swingLow) {
    return { type: 'BULLISH' };
  }
  
  // Bearish Sweep: Price goes above recent swing high but closes below it
  if (current.high > swingHigh && current.close < swingHigh) {
    return { type: 'BEARISH' };
  }
  
  return null;
}

export function synthesizeDailyCandles(candles: Candle[], intervalMultiplier: number): Candle[] {
  const dailyCandles: Candle[] = [];
  const chunkSize = Math.floor(288 / intervalMultiplier); // Based on 5m candles (288 per day)
  
  for (let i = 0; i < candles.length; i += chunkSize) {
    const startIdx = i;
    const endIdx = Math.min(i + chunkSize - 1, candles.length - 1);
    
    let high = -Infinity;
    let low = Infinity;
    let vol = 0;
    
    for (let j = startIdx; j <= endIdx; j++) {
        if (candles[j].high > high) high = candles[j].high;
        if (candles[j].low < low) low = candles[j].low;
        vol += candles[j].volume;
    }
    
    dailyCandles.push({
        timestamp: candles[startIdx].timestamp,
        open: candles[startIdx].open,
        close: candles[endIdx].close,
        high,
        low,
        volume: vol
    });
  }
  return dailyCandles;
}

export function detectDailyTrend(dailyCandles: Candle[]): 'UP' | 'DOWN' | 'RANGE' {
  if (dailyCandles.length < 5) return 'RANGE';
  
  let ema10 = dailyCandles[0].close;
  const k10 = 2 / (Math.min(10, dailyCandles.length) + 1);
  for (let i = 1; i < dailyCandles.length; i++) {
     ema10 = (dailyCandles[i].close * k10) + (ema10 * (1 - k10));
  }
  
  const currentDailyClose = dailyCandles[dailyCandles.length - 1].close;
  if (currentDailyClose > ema10 * 1.005) return 'UP';
  if (currentDailyClose < ema10 * 0.995) return 'DOWN';
  
  return 'RANGE';
}

export function detectCandlePattern(candles: Candle[], type: 'BULLISH' | 'BEARISH'): { isValid: boolean, isGolden: boolean } {
  if (candles.length < 3) return { isValid: false, isGolden: false };
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  
  const currBody = Math.abs(current.close - current.open);
  const currRange = current.high - current.low;
  if (currRange === 0) return { isValid: false, isGolden: false };
  
  const prevBody = Math.abs(prev.close - prev.open);
  const prev2Body = Math.abs(prev2.close - prev2.open);
  
  if (type === 'BULLISH') {
     const isCurrentGreen = current.close > current.open;
     const isPrevRed = prev.close < prev.open;
     const isPrev2Red = prev2.close < prev2.open;
     
     // GOLDEN: Morning Star
     if (isPrev2Red && isCurrentGreen && prev2Body > (prev2.high - prev2.low) * 0.6) {
        if (prevBody < (prev.high - prev.low) * 0.3) { // Doji / Spinning top
           if (current.close > (prev2.open + prev2.close) / 2) {
              return { isValid: true, isGolden: true };
           }
        }
     }
     
     // GOLDEN: High Volume Bullish Engulfing
     if (isCurrentGreen && isPrevRed && current.close > prev.open && current.open <= prev.close && currBody > prevBody) {
        if (current.volume > prev.volume * 1.5) return { isValid: true, isGolden: true };
        return { isValid: true, isGolden: false };
     }
     
     const lowerWick = Math.min(current.open, current.close) - current.low;
     const upperWick = current.high - Math.max(current.open, current.close);
     if (lowerWick >= currRange * 0.5 && upperWick <= currRange * 0.15 && isCurrentGreen) return { isValid: true, isGolden: false };
     
  } else {
     const isCurrentRed = current.close < current.open;
     const isPrevGreen = prev.close > prev.open;
     const isPrev2Green = prev2.close > prev2.open;
     
     // GOLDEN: Evening Star
     if (isPrev2Green && isCurrentRed && prev2Body > (prev2.high - prev2.low) * 0.6) {
        if (prevBody < (prev.high - prev.low) * 0.3) { // Doji / Spinning top
           if (current.close < (prev2.open + prev2.close) / 2) {
              return { isValid: true, isGolden: true };
           }
        }
     }
     
     // GOLDEN: High Volume Bearish Engulfing
     if (isCurrentRed && isPrevGreen && current.close < prev.open && current.open >= prev.close && currBody > prevBody) {
        if (current.volume > prev.volume * 1.5) return { isValid: true, isGolden: true };
        return { isValid: true, isGolden: false };
     }
     
     const lowerWick = Math.min(current.open, current.close) - current.low;
     const upperWick = current.high - Math.max(current.open, current.close);
     if (upperWick >= currRange * 0.5 && lowerWick <= currRange * 0.15 && isCurrentRed) return { isValid: true, isGolden: false };
  }
  return { isValid: false, isGolden: false };
}

export function detectCapitulation(candles: Candle[], lookback: number = 200): 'BULLISH' | 'BEARISH' | null {
  if (candles.length < lookback) return null;
  const current = candles[candles.length - 1];
  
  let totalVol = 0;
  for (let i = candles.length - lookback; i < candles.length - 1; i++) {
    totalVol += candles[i].volume;
  }
  const avgVol = totalVol / (lookback - 1);
  
  // Need at least 3x average volume for Capitulation
  if (current.volume < avgVol * 3) return null;
  
  const currRange = current.high - current.low;
  if (currRange === 0) return null;
  
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const upperWick = current.high - Math.max(current.open, current.close);
  
  // Bullish Capitulation: Long lower wick, heavy volume (Liquidation Sweep)
  if (lowerWick >= currRange * 0.4 && current.close > current.open) {
      return 'BULLISH';
  }
  
  // Bearish Capitulation: Long upper wick, heavy volume
  if (upperWick >= currRange * 0.4 && current.close < current.open) {
      return 'BEARISH';
  }
  
  return null;
}

export function checkEarlyExit(trade: any, candles: Candle[]): boolean {
  if (!trade || trade.pyramidStage !== 0) return false;
  
  const entryIndex = candles.findIndex(c => c.timestamp === trade.entryTime);
  if (entryIndex === -1) return false; // Safety
  
  // THE EXPLOSION FACTOR (Hold onto the rocket)
  const isSqueezing = detectSqueeze(candles);
  const chop = calculateChoppinessIndex(candles, 288);
  const isTrending = chop < 42; 
  
  // If the market is winding up for an explosion (Squeeze) or is currently in a strong trend, DO NOT EXIT EARLY.
  if (isSqueezing || isTrending) return false;
  
  const candlesSinceEntry = candles.length - 1 - entryIndex;
  
  // 1. Time-Based Exit (Dead Momentum)
  if (candlesSinceEntry >= 5) {
      const currentPrice = candles[candles.length - 1].close;
      const isLosing = trade.action === 'BUY' ? currentPrice < trade.entryPrice : currentPrice > trade.entryPrice;
      if (isLosing) return true; // Cut the dead trade
  }
  
  // 2. Volume Absorption (Immediate Reversal)
  if (candlesSinceEntry >= 1 && candlesSinceEntry <= 3) {
      const current = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      
      if (trade.action === 'BUY' && current.close < current.open) {
          if (current.volume > prev.volume * 2 && current.close < trade.entryPrice) {
              return true; // Bail out!
          }
      }
      if (trade.action === 'SELL' && current.close > current.open) {
          if (current.volume > prev.volume * 2 && current.close > trade.entryPrice) {
              return true; // Bail out!
          }
      }
  }
  
  return false;
}
