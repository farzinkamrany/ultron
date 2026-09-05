import { calculateGannSquareOf9, TradeSignal } from './gann';
import { findOrderBlocks } from './ict';

export function evaluateSetup(symbol: string, currentPrice: number, candles: any[]): TradeSignal {
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
      ? !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity)
      : !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity);
    
    if (isValid) {
      return {
        symbol,
        action,
        entryPrice: currentPrice,
        takeProfit: tp,
        stopLoss: sl,
        reason: `Valid SMC+Gann Setup. ${action} at $${currentPrice.toFixed(2)}. Confluence found with swept liquidity OB.`
      };
    }
  }

  return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'No confluence with SMC Order Blocks.' };
}
