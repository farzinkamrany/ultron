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

import ccxt from "ccxt";

export async function detectCapitulation(candles: Candle[], symbol: string, lookback: number = 200): Promise<'BULLISH' | 'BEARISH' | null> {
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
  
  let isBullishStructure = (lowerWick >= currRange * 0.4 && current.close > current.open);
  let isBearishStructure = (upperWick >= currRange * 0.4 && current.close < current.open);
  
  // Calculate 14-period RSI
  let avgGain = 0;
  let avgLoss = 0;
  const rsiPeriod = 14;
  for (let i = candles.length - rsiPeriod; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) avgGain += change;
      else avgLoss -= change;
  }
  avgGain /= rsiPeriod;
  avgLoss /= rsiPeriod;
  
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  
  // Require RSI confirmation for Mean Reversion
  if (isBullishStructure && rsi > 35) isBullishStructure = false; // Dump must reach extreme oversold
  if (isBearishStructure && rsi < 65) isBearishStructure = false; // Pump must reach extreme overbought
  
  if (!isBullishStructure && !isBearishStructure) return null;

  // TAPE READING (CVD Confirmation) - ONLY IN MICRO MODE
  let cvd = 0;
  if (process.env.TRADE_MODE === "MICRO") {
      try {
          const exchange = new ccxt.kucoin();
          const trades = await exchange.fetchTrades(symbol, undefined, 500); // last 500 trades
          for (const t of trades) {
              if (t.side === 'buy') cvd += ((t.amount || 0) * (t.price || 0));
              if (t.side === 'sell') cvd -= ((t.amount || 0) * (t.price || 0));
          }
      } catch (e) {
          console.warn(`[Tape Reading] Failed to fetch trades for ${symbol}. Bypassing CVD check.`);
      }
  }

  // Bullish Capitulation: Long lower wick, heavy volume + Retail Panic Selling (Negative CVD)
  if (isBullishStructure) {
      if (cvd < 0 || cvd === 0) return 'BULLISH'; // Negative CVD means heavy market sells into limit buy walls
  }
  
  // Bearish Capitulation: Long upper wick, heavy volume + Retail Euphoria Buying (Positive CVD)
  if (isBearishStructure) {
      if (cvd > 0 || cvd === 0) return 'BEARISH';
  }
  
  return null;
}

export function checkEarlyExit(trade: any, candles: Candle[]): boolean {
  // All emotional 'fear-based' early exits (impatience, single red candle panic) 
  // have been removed. Let the fat-tail math work.
  return false;
}

export function synthesizeHourlyCandles(candles: Candle[]): Candle[] {
    const hourly: Candle[] = [];
    let currentHour = -1;
    let currentCandle: any = null;
    
    for (const c of candles) {
        const hourId = Math.floor(c.timestamp / (1000 * 60 * 60));
        if (hourId !== currentHour) {
            if (currentCandle) hourly.push(currentCandle);
            currentHour = hourId;
            currentCandle = { ...c };
        } else {
            currentCandle.high = Math.max(currentCandle.high, c.high);
            currentCandle.low = Math.min(currentCandle.low, c.low);
            currentCandle.close = c.close;
            currentCandle.volume += c.volume;
        }
    }
    if (currentCandle) hourly.push(currentCandle);
    return hourly;
}

export function calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1]?.close || 0;
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
        ema = (candles[i].close - ema) * k + ema;
    }
    return ema;
}

export function calculateADX(candles: Candle[], period: number = 14): number {
    if (candles.length <= period * 2) return 0;
    
    let tr = 0, plusDM = 0, minusDM = 0;
    for (let i = 1; i <= period; i++) {
        const c = candles[i];
        const p = candles[i-1];
        
        const trueRange = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        const upMove = c.high - p.high;
        const downMove = p.low - c.low;
        
        let pDM = 0, mDM = 0;
        if (upMove > downMove && upMove > 0) pDM = upMove;
        if (downMove > upMove && downMove > 0) mDM = downMove;
        
        tr += trueRange;
        plusDM += pDM;
        minusDM += mDM;
    }
    
    let smoothedTR = tr, smoothedPlusDM = plusDM, smoothedMinusDM = minusDM;
    let adxSum = 0, adxCount = 0, prevAdx = 0;
    
    for (let i = period + 1; i < candles.length; i++) {
        const c = candles[i];
        const p = candles[i-1];
        
        const trueRange = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        const upMove = c.high - p.high;
        const downMove = p.low - c.low;
        
        let pDM = 0, mDM = 0;
        if (upMove > downMove && upMove > 0) pDM = upMove;
        if (downMove > upMove && downMove > 0) mDM = downMove;
        
        smoothedTR = smoothedTR - (smoothedTR / period) + trueRange;
        smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + pDM;
        smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + mDM;
        
        if (smoothedTR === 0) continue;
        
        const plusDI = 100 * (smoothedPlusDM / smoothedTR);
        const minusDI = 100 * (smoothedMinusDM / smoothedTR);
        const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
        
        if (adxCount === 0) {
            adxSum += dx;
            if (i >= period * 2) {
                prevAdx = adxSum / period;
                adxCount++;
            }
        } else {
            prevAdx = ((prevAdx * (period - 1)) + dx) / period;
        }
    }
    
    return prevAdx;
}

export function detectRegime(candles: any[]): 'TRENDING' | 'RANGING' | 'HIGH_VOL' | 'NORMAL' {
    if (candles.length < 110) return 'NORMAL';
    const chop = calculateChoppinessIndex(candles, 14);
    const adx  = calculateADX(candles, 14);
    let shortATR = 0;
    for (let i = candles.length - 14; i < candles.length; i++) {
        const c = candles[i], p = candles[i - 1];
        shortATR += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    shortATR /= 14;
    let baseATR = 0;
    const bStart = Math.max(1, candles.length - 110);
    for (let i = bStart; i < bStart + 14; i++) {
        const c = candles[i], p = candles[i - 1];
        baseATR += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    baseATR /= 14;
    if (baseATR > 0 && shortATR > baseATR * 1.8) return 'HIGH_VOL';
    if (adx > 25 && chop < 38) return 'TRENDING';
    if (chop > 55) return 'RANGING';
    return 'NORMAL';
}
