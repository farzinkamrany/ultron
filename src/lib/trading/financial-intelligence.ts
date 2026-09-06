export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface SetupSignal {
  action: 'LONG' | 'SHORT' | 'WAIT';
  reason?: string;
  entry: number;
  takeProfit: number;
  stopLoss: number;
  symbol: string;
}

export function calculateEMA(candles: Candle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  
  for (let i = 1; i < candles.length; i++) {
    ema = (candles[i].close * k) + (ema * (1 - k));
  }
  return ema;
}

export function calculateGannLevels(price: number): { supports: number[], resistances: number[] } {
  const root = Math.sqrt(price);
  const increments = [0.125, 0.25, 0.333, 0.4, 0.5, 0.75, 1.0];
  const supports: number[] = [];
  const resistances: number[] = [];
  
  for (const inc of increments) {
    supports.push(Math.pow(root - inc, 2));
    resistances.push(Math.pow(root + inc, 2));
  }
  // Sort supports descending (closest to price first)
  supports.sort((a, b) => b - a);
  // Sort resistances ascending (closest to price first)
  resistances.sort((a, b) => a - b);
  
  return { supports, resistances };
}

// FVG: Candle 1 High < Candle 3 Low (Bullish) or Candle 1 Low > Candle 3 High (Bearish)
export function detectFVG(candles: Candle[]): { type: TrendDirection, gapStart: number, gapEnd: number } | null {
  if (candles.length < 3) return null;
  // Look at the last 3 candles
  const c1 = candles[candles.length - 3];
  const c3 = candles[candles.length - 1];
  
  if (c1.high < c3.low) {
    return { type: 'BULLISH', gapStart: c1.high, gapEnd: c3.low };
  }
  if (c1.low > c3.high) {
    return { type: 'BEARISH', gapStart: c1.low, gapEnd: c3.high };
  }
  
  return null;
}

export function detectOrderBlock(candles: Candle[]): { type: TrendDirection, obCandle: Candle } | null {
  if (candles.length < 3) return null;
  
  // We scan the last 5 candles to find an OB pattern ending in a FVG
  for (let i = candles.length - 3; i >= Math.max(0, candles.length - 5); i--) {
    const obCandle = candles[i];
    const impulseCandle = candles[i + 1];
    const fvgCandle = candles[i + 2];
    
    // Bullish OB
    if (obCandle.close < obCandle.open && impulseCandle.close > impulseCandle.open) {
      if (impulseCandle.close > obCandle.open) { // Engulfing/Impulsive
        if (obCandle.high < fvgCandle.low) {
          return { type: 'BULLISH', obCandle };
        }
      }
    }
    
    // Bearish OB
    if (obCandle.close > obCandle.open && impulseCandle.close < impulseCandle.open) {
      if (impulseCandle.close < obCandle.open) {
        if (obCandle.low > fvgCandle.high) {
          return { type: 'BEARISH', obCandle };
        }
      }
    }
  }
  
  return null;
}

export function evaluateSetup(
  symbol: string,
  candles15m: Candle[],
  candles1h: Candle[]
): SetupSignal {
  const currentPrice = candles15m[candles15m.length - 1].close;
  const ema200 = calculateEMA(candles1h, 200);
  
  const ob = detectOrderBlock(candles15m);
  
  const defaultWait: SetupSignal = { action: 'WAIT', entry: currentPrice, takeProfit: 0, stopLoss: 0, symbol, reason: 'No Setup' };
  
  if (!ob) return { ...defaultWait, reason: 'No valid OB/FVG pattern' };
  
  // LONG condition
  if (currentPrice > ema200 && ob.type === 'BULLISH') {
    // Generate Gann levels from the pivot low of the OB
    const gann = calculateGannLevels(ob.obCandle.low);

    // Determine SL (Wick of OB + 0.1% buffer)
    const sl = ob.obCandle.low * (1 - 0.001); // 0.1% buffer
    
    // Determine TP (Next Gann Resistance)
    let tp = gann.resistances[0];
    for (const r of gann.resistances) {
      if (r > currentPrice) {
        tp = r;
        break;
      }
    }
    
    const risk = currentPrice - sl;
    const reward = tp - currentPrice;
    
    if (risk <= 0 || reward <= 0) return { ...defaultWait, reason: 'Invalid Risk/Reward calculation (Price beyond SL)' };
    
    const rr = reward / risk;
    
    if (rr < 2.0) {
      return { ...defaultWait, reason: `Low R:R Ratio` };
    }
    
    return { action: 'LONG', symbol, entry: currentPrice, stopLoss: sl, takeProfit: tp };
  }
  
  // SHORT condition
  if (currentPrice < ema200 && ob.type === 'BEARISH') {
    // Generate Gann levels from the pivot high of the OB
    const gann = calculateGannLevels(ob.obCandle.high);

    const sl = ob.obCandle.high * (1 + 0.001); // 0.1% buffer
    
    let tp = gann.supports[0];
    for (const s of gann.supports) {
      if (s < currentPrice) {
        tp = s;
        break;
      }
    }
    
    const risk = sl - currentPrice;
    const reward = currentPrice - tp;
    
    if (risk <= 0 || reward <= 0) return { ...defaultWait, reason: 'Invalid Risk/Reward calculation (Price beyond SL)' };
    
    const rr = reward / risk;
    
    if (rr < 2.0) {
      return { ...defaultWait, reason: `Low R:R Ratio` };
    }
    
    return { action: 'SHORT', symbol, entry: currentPrice, stopLoss: sl, takeProfit: tp };
  }
  
  return { ...defaultWait, reason: 'Macro Trend Mismatch' };
}
