// W.D. Gann Predictive Trading Engine - Basic Implementation

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
}

/**
 * Calculates Support/Resistance levels based on Gann Square of 9
 * Formula: Level = (sqrt(Price) +/- increment)^2
 */
export function calculateGannSquareOf9(price: number): { supports: number[], resistances: number[] } {
  const root = Math.sqrt(price);
  
  // Standard increments based on degrees (e.g. 0.25 = 45 degrees, 0.5 = 90 degrees, 1 = 360 degrees, 2 = 720 degrees)
  // We include larger increments (2, 3, 4) to allow for 6-month macro targets.
  const increments = [0.125, 0.25, 0.5, 1, 1.5, 2, 3, 4]; 
  
  const supports = increments.map(inc => Math.pow(root - inc, 2));
  const resistances = increments.map(inc => Math.pow(root + inc, 2));
  
  return { supports, resistances };
}

/**
 * Gann Master Time Cycles (Days)
 * These represent key harmonic divisions of a 360-degree circle (year).
 */
export const GANN_TIME_CYCLES = [7, 14, 21, 45, 90, 135, 144, 180, 270, 360];

export function calculateTimeCycles(daysSincePivot: number): { currentCyclePassed: number, nextCycle: number, daysToNextCycle: number, isReversalWindow: boolean } {
  let currentCyclePassed = 0;
  let nextCycle = GANN_TIME_CYCLES[GANN_TIME_CYCLES.length - 1]; // default to max

  for (const cycle of GANN_TIME_CYCLES) {
    if (daysSincePivot >= cycle) {
      currentCyclePassed = cycle;
    } else {
      nextCycle = cycle;
      break;
    }
  }

  const daysToNextCycle = nextCycle - daysSincePivot;
  
  // A Reversal Window is considered +/- 3 days from an exact Gann Cycle
  const isReversalWindow = (daysToNextCycle <= 3) || (daysSincePivot - currentCyclePassed <= 3 && currentCyclePassed !== 0);

  return { currentCyclePassed, nextCycle, daysToNextCycle, isReversalWindow };
}

/**
 * Gann Angles (Gann Fans)
 * Calculates geometric support/resistance lines originating from a pivot.
 * Auto-scales the 1x1 angle based on 0.25% daily growth of the pivot price.
 */
export function calculateGannAngles(pivotPrice: number, daysSincePivot: number, currentPrice: number) {
  // Scale factor: 1x1 angle represents 0.25% daily growth of the pivot price
  const scaleFactor = pivotPrice * 0.0025;
  
  const angle1x2 = pivotPrice + (daysSincePivot * scaleFactor * 0.5); // Slow growth
  const angle1x1 = pivotPrice + (daysSincePivot * scaleFactor * 1.0); // Balanced growth (45 deg)
  const angle2x1 = pivotPrice + (daysSincePivot * scaleFactor * 2.0); // Fast growth

  let position = "BELOW 1x2 (Extremely Bearish)";
  if (currentPrice > angle2x1) position = "ABOVE 2x1 (Extremely Bullish)";
  else if (currentPrice > angle1x1) position = "BETWEEN 1x1 and 2x1 (Bullish)";
  else if (currentPrice > angle1x2) position = "BETWEEN 1x2 and 1x1 (Weak/Ranging)";

  return { angle1x2, angle1x1, angle2x1, position };
}

/**
 * Gann Seasonal & Anniversary Cycles
 * Checks if today aligns with a historical pivot anniversary or a major Solar Equinox/Solstice.
 */
export function calculateAnniversaryCycles(pivotTimestamp: number) {
  const today = new Date();
  const pivot = new Date(pivotTimestamp);
  
  const currentMonth = today.getUTCMonth();
  const currentDay = today.getUTCDate();
  const pivotMonth = pivot.getUTCMonth();
  const pivotDay = pivot.getUTCDate();

  // 1. Anniversary Check (Same Month and Day as the Pivot)
  const isAnniversary = (currentMonth === pivotMonth && Math.abs(currentDay - pivotDay) <= 3);

  // 2. Solar Quarters Check
  // Mar 21 (02-21), Jun 21 (05-21), Sep 23 (08-23), Dec 21 (11-21)
  const solarDates = [
    { m: 2, d: 21, name: "Vernal Equinox" },
    { m: 5, d: 21, name: "Summer Solstice" },
    { m: 8, d: 23, name: "Autumnal Equinox" },
    { m: 11, d: 21, name: "Winter Solstice" }
  ];

  let activeSolarQuarter = null;
  for (const sd of solarDates) {
    if (currentMonth === sd.m && Math.abs(currentDay - sd.d) <= 3) {
      activeSolarQuarter = sd.name;
      break;
    }
  }

  const isSeasonalReversal = isAnniversary || (activeSolarQuarter !== null);

  return { isAnniversary, activeSolarQuarter, isSeasonalReversal };
}

/**
 * Analyzes market data to find Gann alignments and emit paper-trade signals.
 * Incorporates strict 2% risk management.
 */
export function analyzeGannSetup(symbol: string, currentPrice: number, recentCandles: Candle[]): TradeSignal {
  // 1. Find recent major pivot (simplified: highest high and lowest low in lookback)
  let highest = -Infinity;
  let lowest = Infinity;
  for (const c of recentCandles) {
    if (c.high > highest) highest = c.high;
    if (c.low < lowest) lowest = c.low;
  }

  // 2. Calculate Gann Levels
  const { supports, resistances } = calculateGannSquareOf9(lowest); // using major bottom as base

  // 3. Determine if current price is bouncing off a Gann Support
  const closestSupport = supports.find(s => Math.abs(currentPrice - s) / currentPrice < 0.01); // 1% tolerance
  
  if (closestSupport && currentPrice > closestSupport) {
    // Structural bounce detected -> BUY SIGNAL
    // Strict Guardrail: Stop-Loss just below support, max risk 2%
    const stopLoss = closestSupport * 0.99; 
    
    // Validate max drawdown (Risk = Entry - StopLoss)
    const riskPercent = (currentPrice - stopLoss) / currentPrice;
    
    if (riskPercent <= 0.02) {
       return {
         symbol,
         action: "BUY",
         entryPrice: currentPrice,
         stopLoss: stopLoss,
         takeProfit: resistances[0] || (currentPrice * 1.05), // First resistance or 5% gain
         reason: `Price bounced off Gann Square of 9 support level (${closestSupport.toFixed(2)}). Risk is ${ (riskPercent*100).toFixed(2) }%.`
       };
    }
  }

  return {
    symbol,
    action: "HOLD",
    entryPrice: currentPrice,
    stopLoss: 0,
    takeProfit: 0,
    reason: "No optimal Gann alignment or risk too high (>2%)."
  };
}
