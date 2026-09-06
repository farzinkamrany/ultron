import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateDownwardGannAngles, calculateCosmicAlignment, TradeSignal } from './gann';
import { findOrderBlocks } from './ict';

// ─── CIRCUIT BREAKER ─────────────────────────────────────────────────────────
// Prevents runaway losses by pausing trading when daily drawdown exceeds MAX_DAILY_LOSS
// or when a consecutive losing streak is detected.
export const CIRCUIT_BREAKER = {
  enabled: true,
  MAX_DAILY_LOSS: 0.10,        // Stop trading if daily loss > 10% of balance
  MAX_CONSECUTIVE_LOSSES: 5,   // Stop trading after 5 losses in a row
  COOLDOWN_CANDLES: 8,         // How many candles to wait before resuming
  // Runtime state (reset at start of each backtest/session)
  consecutiveLosses: 0,
  coolingDownUntil: 0,         // timestamp or candle index
  dailyPeakBalance: 0,
  lastResetDay: -1,
};

export function resetCircuitBreaker(balance: number) {
  CIRCUIT_BREAKER.consecutiveLosses = 0;
  CIRCUIT_BREAKER.coolingDownUntil = 0;
  CIRCUIT_BREAKER.dailyPeakBalance = balance;
  CIRCUIT_BREAKER.lastResetDay = -1;
}

export function updateCircuitBreaker(won: boolean, balance: number, candleIndex: number, timestamp: number) {
  // Reset daily peak at start of new day
  const currentDay = Math.floor(timestamp / (1000 * 60 * 60 * 24));
  if (currentDay !== CIRCUIT_BREAKER.lastResetDay) {
    CIRCUIT_BREAKER.dailyPeakBalance = Math.max(CIRCUIT_BREAKER.dailyPeakBalance, balance);
    CIRCUIT_BREAKER.lastResetDay = currentDay;
  }

  if (won) {
    CIRCUIT_BREAKER.consecutiveLosses = 0;
  } else {
    CIRCUIT_BREAKER.consecutiveLosses++;
    // Trigger cooldown if streak exceeded
    if (CIRCUIT_BREAKER.consecutiveLosses >= CIRCUIT_BREAKER.MAX_CONSECUTIVE_LOSSES) {
      CIRCUIT_BREAKER.coolingDownUntil = candleIndex + CIRCUIT_BREAKER.COOLDOWN_CANDLES;
    }
    // Trigger cooldown if daily loss exceeded
    const dailyLoss = (CIRCUIT_BREAKER.dailyPeakBalance - balance) / CIRCUIT_BREAKER.dailyPeakBalance;
    if (dailyLoss >= CIRCUIT_BREAKER.MAX_DAILY_LOSS) {
      CIRCUIT_BREAKER.coolingDownUntil = candleIndex + CIRCUIT_BREAKER.COOLDOWN_CANDLES;
    }
  }
}

export function isCircuitBreakerActive(candleIndex: number): boolean {
  if (!CIRCUIT_BREAKER.enabled) return false;
  return candleIndex < CIRCUIT_BREAKER.coolingDownUntil;
}
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateSetup(symbol: string, currentPrice: number, candles: any[], macroCandles: any[]): TradeSignal {
  const SL_BUFFER = 0.003;

  // 1. Calculate the true Macro Pivot for Gann Math
  let absoluteLow = Infinity;
  let absoluteHigh = -Infinity;
  let pivotTimestamp = 0;
  let highTimestamp = 0;

  for (const candle of macroCandles) {
    if (candle.low < absoluteLow) { absoluteLow = candle.low; pivotTimestamp = candle.timestamp; }
    if (candle.high > absoluteHigh) { absoluteHigh = candle.high; highTimestamp = candle.timestamp; }
  }

  // Fallback if macro candles are missing
  if (absoluteLow === Infinity) absoluteLow = currentPrice;

  // 2. Calculate true Harmonic Square of 9 levels from the absolute Low
  const { supports, resistances } = calculateGannSquareOf9(absoluteLow, currentPrice);
  
  let closestSupport = 0, closestResistance = 0;
  for (const s of supports) if (currentPrice >= s) { closestSupport = s; break; }
  for (const r of resistances) if (r >= currentPrice) { closestResistance = r; break; }

  if (closestSupport === 0 || closestResistance === 0) {
    return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'No Gann levels found near current price.' };
  }

  // 3. Dynamic ATR Calculation for Stop Loss Padding (14-period)
  let trSum = 0;
  for (let i = Math.max(1, candles.length - 14); i < candles.length; i++) {
    const c = candles[i];
    const prevC = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close));
    trSum += tr;
  }
  const atr = trSum / Math.min(14, candles.length - 1);
  const atrPadding = atr * 1.5; // 1.5x ATR padding to prevent leverage traps
  
  const distToSupp = (currentPrice - closestSupport) / currentPrice;
  const distToRes = (closestResistance - currentPrice) / currentPrice;
  
  let action: 'BUY' | 'SELL' | null = null;
  let tp = 0, sl = 0;

  if (distToSupp <= SL_BUFFER) {
    const longSL = closestSupport - atrPadding;
    const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - longSL) >= 2.0);
    if (validTP) { action = 'BUY'; tp = validTP; sl = longSL; }
  } else if (distToRes <= SL_BUFFER) {
    const shortSL = closestResistance + atrPadding;
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
      // Macro pivots are already calculated at the top


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

      // --- HIGH PRECISION ASTRONOMY FILTERS ---
      // Currently disabled because they are incompatible with Bitcoin's volatile nature. 
      // Keep them here until we find an asset that harmonizes with them.
      const ENABLE_ASTRONOMY_FILTERS = false;
      
      if (ENABLE_ASTRONOMY_FILTERS) {
        // 1. Natural Energy Wave (Seasonal Block)
        if (cosmos.naturalEnergyWave > 0.5 && action === 'SELL') {
          return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: `Rejected: Seasonal Energy is strongly Bullish (+${cosmos.naturalEnergyWave.toFixed(2)}). Selling is prohibited.` };
        }
        if (cosmos.naturalEnergyWave < -0.5 && action === 'BUY') {
          return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: `Rejected: Seasonal Energy is strongly Bearish (${cosmos.naturalEnergyWave.toFixed(2)}). Buying is prohibited.` };
        }

        // 2. Planetary Aspect Volatility Constraint
        if (cosmos.planetaryAspect) {
          const rr = action === 'BUY' ? (tp - currentPrice) / (currentPrice - sl) : (currentPrice - tp) / (sl - currentPrice);
          if (rr < 3.0) {
             return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: `Rejected: Planetary aspect ${cosmos.planetaryAspect} detected. Chaotic volatility requires R:R > 3.0 (Current: ${rr.toFixed(2)}).` };
          }
          gannContext += ` | ⚡ COSMIC VOLATILITY OVERRIDDEN (R:R ${rr.toFixed(2)} > 3.0)`;
        } else if (cosmos.alignmentString !== "No Cosmic Alignment") {
          gannContext += ` | 🪐 ${cosmos.alignmentString}`;
        }
      }

      // 3. Jupiter Price Magnet
      const jupiterDist = Math.abs(currentPrice - cosmos.jupiterPriceSupport) / currentPrice;
      if (jupiterDist <= 0.02) {
        gannContext += ` | ✨ JUPITER MAGNET ALIGNMENT ($${cosmos.jupiterPriceSupport.toFixed(2)})`;
      }

      if (isReversalWindow) gannContext += ' | ⏳ TIME REVERSAL WINDOW ACTIVE';

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
