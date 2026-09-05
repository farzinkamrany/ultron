import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateDownwardGannAngles, calculateCosmicAlignment, TradeSignal } from './gann';
import { findOrderBlocks } from './ict';

export function evaluateSetup(symbol: string, currentPrice: number, candles: any[], macroCandles: any[]): TradeSignal {
  const SL_BUFFER = 0.003;
  const { supports, resistances } = calculateGannSquareOf9(currentPrice);
  
  let closestSupport = 0, closestResistance = 0;
  for (const s of supports) if (currentPrice >= s) { closestSupport = s; break; }
  for (const r of resistances) if (r >= currentPrice) { closestResistance = r; break; }

  if (closestSupport === 0 || closestResistance === 0) {
    return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'No Gann levels found near current price.' };
  }

  const distToSupp = (currentPrice - closestSupport) / currentPrice;
  const distToRes = (closestResistance - currentPrice) / currentPrice;
  
  let action: 'BUY' | 'SELL' | null = null;
  let tp = 0, sl = 0;

  if (distToSupp <= SL_BUFFER) {
    const longSL = closestSupport * (1 - SL_BUFFER);
    const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - longSL) >= 2.0);
    if (validTP) { action = 'BUY'; tp = validTP; sl = longSL; }
  } else if (distToRes <= SL_BUFFER) {
    const shortSL = closestResistance * (1 + SL_BUFFER);
    const validTP = supports.find(s => (currentPrice - s) / (shortSL - currentPrice) >= 2.0);
    if (validTP) { action = 'SELL'; tp = validTP; sl = shortSL; }
  }

  if (action) {
    const obs = findOrderBlocks(candles);
    const isValid = action === 'BUY'
      ? !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && currentPrice <= ob.top * 1.001 && currentPrice >= ob.bottom * 0.999)
      : !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && currentPrice >= ob.bottom * 0.999 && currentPrice <= ob.top * 1.001);
    
    if (isValid) {
      // FULL GANN FILTERS
      let absoluteLow = Infinity;
      let absoluteHigh = -Infinity;
      let pivotTimestamp = 0;
      let highTimestamp = 0;

      for (const candle of macroCandles) {
        if (candle.low < absoluteLow) { absoluteLow = candle.low; pivotTimestamp = candle.timestamp; }
        if (candle.high > absoluteHigh) { absoluteHigh = candle.high; highTimestamp = candle.timestamp; }
      }

      const trueScaleFactor = (absoluteHigh - absoluteLow) / 365;
      const daysSincePivot = Math.floor((Date.now() - pivotTimestamp) / (1000 * 60 * 60 * 24));
      const daysSinceHigh = Math.floor((Date.now() - highTimestamp) / (1000 * 60 * 60 * 24));

      const upwardAngles = calculateGannAngles(absoluteLow, daysSincePivot, currentPrice, trueScaleFactor);
      const downwardAngles = calculateDownwardGannAngles(absoluteHigh, daysSinceHigh, currentPrice, trueScaleFactor);
      
      const { isReversalWindow } = calculateTimeCycles(daysSincePivot);
      const cosmos = calculateCosmicAlignment(currentPrice);

      let gannContext = '';

      if (action === 'BUY') {
        if (downwardAngles.position.includes('BELOW 2x1')) {
          return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'Rejected: Downward Gann Angle indicates Freefall.' };
        }
        if (upwardAngles.position.includes('ABOVE')) gannContext += ' | Strong Upward Gann Angle';
      } else if (action === 'SELL') {
        if (upwardAngles.position.includes('ABOVE 2x1')) {
          return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'Rejected: Upward Gann Angle indicates Extreme Bull.' };
        }
        if (downwardAngles.position.includes('BELOW')) gannContext += ' | Strong Downward Gann Angle';
      }

      if (isReversalWindow) gannContext += ' | TIME REVERSAL WINDOW ACTIVE';
      if (cosmos.planetaryAspect) gannContext += ` | COSMIC VOLATILITY (${cosmos.planetaryAspect})`;

      return {
        symbol,
        action,
        entryPrice: currentPrice,
        takeProfit: tp,
        stopLoss: sl,
        reason: `Valid SMC+Gann Setup. ${action} at $${currentPrice.toFixed(2)}. Confluence found with swept liquidity OB.${gannContext}`
      };
    }
  }

  return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'No confluence with SMC Order Blocks.' };
}
