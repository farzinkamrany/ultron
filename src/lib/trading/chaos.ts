export interface MacroOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculates the True Range of a single candle relative to the previous candle.
 */
function calculateTrueRange(current: MacroOHLCV, prev: MacroOHLCV): number {
  const highLow = current.high - current.low;
  const highClose = Math.abs(current.high - prev.close);
  const lowClose = Math.abs(current.low - prev.close);
  return Math.max(highLow, highClose, lowClose);
}

/**
 * Calculates the Average True Range (ATR) over a specific period.
 */
function calculateATR(candles: MacroOHLCV[], period: number): number {
  if (candles.length <= period) return 0;
  
  let trSum = 0;
  const startIndex = candles.length - period;
  
  for (let i = startIndex; i < candles.length; i++) {
    trSum += calculateTrueRange(candles[i], candles[i - 1]);
  }
  
  return trSum / period;
}

/**
 * Calculates the Simple Moving Average (SMA) over a specific period.
 */
function calculateSMA(candles: MacroOHLCV[], period: number): number {
  if (candles.length < period) return 0;
  let sum = 0;
  const startIndex = candles.length - period;
  for (let i = startIndex; i < candles.length; i++) {
    sum += candles[i].close;
  }
  return sum / period;
}

/**
 * The Chaos Engine (DEFCON Protocol)
 * Analyzes mathematical volatility to detect Black Swan events or War panics.
 */
export function calculateChaosLevel(candles: MacroOHLCV[]) {
  if (candles.length < 90) return { level: 5, description: "Insufficient Data for Chaos Engine" };

  const atr14 = calculateATR(candles, 14);
  const atr90 = calculateATR(candles, 90);
  const sma20 = calculateSMA(candles, 20);
  
  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  
  // Flash Crash Detector (> 10% drop in a single day)
  const currentDropPct = (currentCandle.open - currentCandle.close) / currentCandle.open;
  const previousDropPct = (previousCandle.open - previousCandle.close) / previousCandle.open;
  
  if (currentDropPct > 0.10 || previousDropPct > 0.10) {
    return {
      level: 1,
      description: "DEFCON 1 (FLASH CRASH / PANIC DUMP): Massive >10% single-day wipeout detected. Abandon all technical analysis."
    };
  }
  
  // Violent Downside Volatility (ATR expansion + Downtrend)
  if (atr14 > atr90 * 1.5 && currentCandle.close < sma20) {
    return {
      level: 2,
      description: "DEFCON 2 (SEVERE PANIC): Volatility has spiked >150% and price is in freefall below SMA20."
    };
  }
  
  // Violent Upside Volatility (ATR expansion + Uptrend)
  if (atr14 > atr90 * 1.5 && currentCandle.close > sma20) {
    return {
      level: 3,
      description: "DEFCON 3 (EUPHORIA / HIGH VOLATILITY): Extreme volatility, but price is rising. Trade with caution."
    };
  }
  
  // Mildly elevated volatility
  if (atr14 > atr90) {
    return {
      level: 4,
      description: "DEFCON 4 (ELEVATED VOLATILITY): Volatility is slightly above average baseline."
    };
  }
  
  // Normal Market Conditions
  return {
    level: 5,
    description: "DEFCON 5 (PEACE / NORMAL): Normal market volatility. Technicals are highly reliable."
  };
}
