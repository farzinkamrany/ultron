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
  
  // Standard increments based on degrees (e.g. 0.25 = 45 degrees, 0.5 = 90 degrees)
  const increments = [0.125, 0.25, 0.5, 1]; 
  
  const supports = increments.map(inc => Math.pow(root - inc, 2));
  const resistances = increments.map(inc => Math.pow(root + inc, 2));
  
  return { supports, resistances };
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
