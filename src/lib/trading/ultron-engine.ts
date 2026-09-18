/**
 * Ultron Engine — V5.0 Live Adapter
 *
 * Takes the exact same Behemoth/Leviathan/Megalodon logic from the backtester
 * and adapts it for live 4H candle data from the exchange.
 *
 * Strategy summary:
 *  - BEHEMOTH: ATR-Adaptive Long-Only Grid (Range markets)
 *  - LEVIATHAN: RSI + EMA Cross Trend-Following (Trend markets)
 *  - MEGALODON: EMA-800 Macro Trend Ride (Always active on big trends)
 *
 * Returns an array of OrchestratorSignal objects to be executed by the caller.
 */

import { Candle } from './financial-intelligence';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OrchestratorSignal {
  symbol: string;
  strategy: 'BEHEMOTH' | 'LEVIATHAN' | 'MEGALODON';
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT' | 'GRID_UPDATE';
  stopLoss: number;
  takeProfit: number;
  positionSizeUsd: number;
  reason: string;
  // Grid-specific state (stored in Redis between cron runs)
  gridState?: GridLevel[];
  gridStep?: number;
}

export interface GridLevel { price: number; type: 'BUY' | 'SELL'; active: boolean; }

export interface LiveSymbolState {
  symbol: string;
  currentRegime: 'RANGE' | 'TREND' | 'UNKNOWN';
  // Behemoth
  gridActive: boolean;
  grid: GridLevel[];
  positionCoins: number;
  avgEntryPrice: number;
  realizedGridPnl: number;
  orderSizeUsd: number;
  gridStep: number;
  behemothCooldownUntil: number;
  // Leviathan
  leviathanTrade: {
    action: 'BUY' | 'SELL';
    entryPrice: number;
    sl: number;
    positionSize: number;
    partialTaken: boolean;
  } | null;
  // Megalodon
  megalodonTrade: {
    action: 'BUY' | 'SELL';
    entryPrice: number;
    sl: number;
    positionSize: number;
  } | null;
  megalodonCooldownUntil: number;
}

export const DEFAULT_SYMBOL_STATE: Omit<LiveSymbolState, 'symbol'> = {
  currentRegime: 'UNKNOWN',
  gridActive: false,
  grid: [],
  positionCoins: 0,
  avgEntryPrice: 0,
  realizedGridPnl: 0,
  orderSizeUsd: 0,
  gridStep: 0,
  behemothCooldownUntil: 0,
  leviathanTrade: null,
  megalodonTrade: null,
  megalodonCooldownUntil: 0,
};

// ─── Constants ─────────────────────────────────────────────────────────────

const GRID_LEVELS = 20;
const TAKER_FEE = 0.00035;
const MAKER_FEE = -0.0001;
const SLIPPAGE = 0.001;
const MAX_PORTFOLIO_LEVERAGE = 5.0;

// ─── Indicators ────────────────────────────────────────────────────────────

function ema(candles: Candle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1].close;
  const k = 2 / (period + 1);
  let val = candles.slice(0, period).reduce((a, c) => a + c.close, 0) / period;
  for (let i = period; i < candles.length; i++) {
    val = (candles[i].close - val) * k + val;
  }
  return val;
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length <= period) return 0;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / period;
}

function rsi(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function adx(candles: Candle[], period = 14): number {
  if (candles.length < period * 2) return 0;
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    if (up > down && up > 0) plusDM += up;
    if (down > up && down > 0) minusDM += down;
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trSum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  if (trSum === 0) return 0;
  const plusDI = (plusDM / trSum) * 100;
  const minusDI = (minusDM / trSum) * 100;
  const sumDI = plusDI + minusDI;
  if (sumDI === 0) return 0;
  return (Math.abs(plusDI - minusDI) / sumDI) * 100;
}

function highest(candles: Candle[], period: number, offset = 0): number {
  let h = -Infinity;
  const start = Math.max(0, candles.length - period - offset);
  const end = candles.length - offset;
  for (let i = start; i < end; i++) if (candles[i].high > h) h = candles[i].high;
  return h;
}

function lowest(candles: Candle[], period: number, offset = 0): number {
  let l = Infinity;
  const start = Math.max(0, candles.length - period - offset);
  const end = candles.length - offset;
  for (let i = start; i < end; i++) if (candles[i].low < l) l = candles[i].low;
  return l;
}

// ─── Main Engine ────────────────────────────────────────────────────────────

/**
 * Processes the latest 4H candles for a single symbol and returns any signals.
 * The caller is responsible for persisting `state` between runs (e.g. Redis).
 *
 * @param state - The current persisted state for this symbol
 * @param candles4H - Full 4H candle history (at least 800 candles for Megalodon)
 * @param accountBalance - Current total account equity in USD
 * @param totalMarginUsed - Total margin currently used across all symbols
 * @returns Updated state + array of signals to execute
 */
export function processSymbol(
  state: LiveSymbolState,
  candles4H: Candle[],
  accountBalance: number,
  totalMarginUsed: number
): { state: LiveSymbolState; signals: OrchestratorSignal[] } {
  const signals: OrchestratorSignal[] = [];
  const candle = candles4H[candles4H.length - 1]; // the just-closed 4H candle
  const now = candle.timestamp;

  const maxAllowedMargin = accountBalance * MAX_PORTFOLIO_LEVERAGE;

  // ── 1. REGIME DETECTION ─────────────────────────────────────────────────
  if (candles4H.length > 50) {
    const adxVal = adx(candles4H, 14);
    let newRegime = state.currentRegime;

    if (state.currentRegime === 'UNKNOWN') {
      newRegime = adxVal < 25 ? 'RANGE' : 'TREND';
    } else if (state.currentRegime === 'RANGE' && adxVal > 27) {
      newRegime = 'TREND';
    } else if (state.currentRegime === 'TREND' && adxVal < 23) {
      newRegime = 'RANGE';
    }
    state.currentRegime = newRegime;
  }

  const behemothWeight = state.currentRegime === 'RANGE' ? 0.30 : 0.00;
  const leviathanWeight = 0.00; // DISABLED (Drag on portfolio)
  const megalodonWeight = state.currentRegime === 'TREND' ? 0.20 : 0.05;

  const behemothCapital = Math.min(accountBalance * behemothWeight, 500_000);
  const leviathanCapital = Math.min(accountBalance * leviathanWeight, 500_000);
  const megalodonCapital = Math.min(accountBalance * megalodonWeight, 500_000);

  // ── 2. BEHEMOTH GRID ─────────────────────────────────────────────────────
  const priceVelocity = candles4H.length > 6
    ? (candle.close - candles4H[candles4H.length - 6].close) / candles4H[candles4H.length - 6].close
    : 0;
  const fallingKnife = priceVelocity < -0.04;

  if (!state.gridActive && candles4H.length > 20 && !fallingKnife
    && state.currentRegime !== 'TREND' && now > state.behemothCooldownUntil) {

    state.grid = [];
    state.positionCoins = 0;
    state.avgEntryPrice = 0;

    const atrVal = atr(candles4H, 14);
    const atrPct = atrVal / candle.close;
    const dynamicRange = Math.min(Math.max(atrPct * 2.5, 0.04), 0.12);

    const upperBound = candle.close * (1 + dynamicRange);
    const lowerBound = candle.close * (1 - dynamicRange);
    state.gridStep = (upperBound - lowerBound) / GRID_LEVELS;

    const targetCapital = Math.min(behemothCapital, Math.max(0, maxAllowedMargin - totalMarginUsed));

    if (targetCapital >= 50) {
      state.orderSizeUsd = targetCapital / (GRID_LEVELS / 2);
      totalMarginUsed += targetCapital;

      for (let j = 0; j <= GRID_LEVELS; j++) {
        const p = lowerBound + (j * state.gridStep);
        if (p < candle.close) state.grid.push({ price: p, type: 'BUY', active: true });
        else state.grid.push({ price: p, type: 'SELL', active: false });
      }
      state.gridActive = true;

      signals.push({
        symbol: state.symbol,
        strategy: 'BEHEMOTH',
        action: 'GRID_UPDATE',
        stopLoss: lowerBound,
        takeProfit: upperBound,
        positionSizeUsd: targetCapital,
        reason: `Behemoth grid started. Range: ${lowerBound.toFixed(2)}-${upperBound.toFixed(2)}, Step: ${state.gridStep.toFixed(2)}`,
        gridState: state.grid,
        gridStep: state.gridStep,
      });
    }

  } else if (state.gridActive) {
    // Process grid levels against current candle
    for (const level of state.grid) {
      if (!level.active) continue;

      if (level.type === 'BUY' && candle.low <= level.price) {
        const coinsBought = state.orderSizeUsd / level.price;
        const totalCost = state.positionCoins * state.avgEntryPrice + coinsBought * level.price;
        state.positionCoins += coinsBought;
        state.avgEntryPrice = totalCost / state.positionCoins;
        state.realizedGridPnl += state.orderSizeUsd * Math.abs(MAKER_FEE);
        level.active = false;
        // Activate the next sell level
        const sellLevel = state.grid.find(g => g.price > level.price);
        if (sellLevel) { sellLevel.type = 'SELL'; sellLevel.active = true; }

        signals.push({
          symbol: state.symbol,
          strategy: 'BEHEMOTH',
          action: 'OPEN_LONG',
          stopLoss: state.grid[0].price,
          takeProfit: level.price + state.gridStep,
          positionSizeUsd: state.orderSizeUsd,
          reason: `Behemoth BUY at grid level ${level.price.toFixed(2)}`,
          gridState: state.grid,
        });
      } else if (level.type === 'SELL' && candle.high >= level.price) {
        if (state.positionCoins > 0) {
          const coinsSold = state.orderSizeUsd / level.price;
          const profitUSD = coinsSold * state.gridStep;
          state.realizedGridPnl += profitUSD + state.orderSizeUsd * Math.abs(MAKER_FEE);
          state.positionCoins = Math.max(0, state.positionCoins - coinsSold);
          if (state.positionCoins < 0.0001) { state.positionCoins = 0; state.avgEntryPrice = 0; }
          level.active = false;
          const buyLevel = state.grid.slice().reverse().find(g => g.price < level.price);
          if (buyLevel) { buyLevel.type = 'BUY'; buyLevel.active = true; }

          signals.push({
            symbol: state.symbol,
            strategy: 'BEHEMOTH',
            action: 'CLOSE_LONG',
            stopLoss: state.grid[0].price,
            takeProfit: level.price,
            positionSizeUsd: state.orderSizeUsd,
            reason: `Behemoth SELL at grid level ${level.price.toFixed(2)}, PnL: +${profitUSD.toFixed(2)}`,
            gridState: state.grid,
          });
        }
      }
    }

    // Check for grid break
    const upperBound = state.grid[state.grid.length - 1].price;
    const lowerBound = state.grid[0].price;
    if (candle.close > upperBound || candle.close < lowerBound) {
      state.gridActive = false;
      if (state.realizedGridPnl > behemothCapital * 0.30) {
        state.behemothCooldownUntil = now + 4 * 3600 * 1000;
      } else {
        state.behemothCooldownUntil = now + 24 * 3600 * 1000;
      }
      state.positionCoins = 0;
      state.avgEntryPrice = 0;
      state.realizedGridPnl = 0;
      state.grid = [];
    }
  }

  // ── 3. LEVIATHAN ─────────────────────────────────────────────────────────
  if (candles4H.length > 200) {
    const ema50  = ema(candles4H, 50);
    const ema200 = ema(candles4H, 200);
    const atrVal = atr(candles4H, 14);
    const rsiVal = rsi(candles4H, 14);
    const high20 = highest(candles4H, 20, 1);
    const low20  = lowest(candles4H, 20, 1);

    if (state.leviathanTrade) {
      const trade = state.leviathanTrade;
      // Partial TP at +40%
      if (!trade.partialTaken) {
        const gainPct = trade.action === 'BUY'
          ? (candle.high - trade.entryPrice) / trade.entryPrice
          : (trade.entryPrice - candle.low) / trade.entryPrice;
        if (gainPct >= 0.40) {
          trade.positionSize *= 0.5;
          trade.partialTaken = true;
          if (trade.action === 'BUY') trade.sl = Math.max(trade.sl, trade.entryPrice);
          else trade.sl = Math.min(trade.sl, trade.entryPrice);
          signals.push({
            symbol: state.symbol,
            strategy: 'LEVIATHAN',
            action: trade.action === 'BUY' ? 'CLOSE_LONG' : 'CLOSE_SHORT',
            stopLoss: trade.sl,
            takeProfit: trade.action === 'BUY' ? trade.entryPrice * 1.40 : trade.entryPrice * 0.60,
            positionSizeUsd: trade.positionSize, // half already taken
            reason: `Leviathan Partial TP at +40% gain`,
          });
        }
      }
      // Trailing stop
      if (trade.action === 'BUY') {
        const trail = lowest(candles4H, 30, 1) - atrVal * 3.0;
        trade.sl = Math.max(trade.sl, trail);
        if (candle.low <= trade.sl) {
          signals.push({
            symbol: state.symbol,
            strategy: 'LEVIATHAN',
            action: 'CLOSE_LONG',
            stopLoss: trade.sl,
            takeProfit: trade.entryPrice * 2,
            positionSizeUsd: trade.positionSize,
            reason: `Leviathan trailing SL hit at ${trade.sl.toFixed(2)}`,
          });
          state.leviathanTrade = null;
        }
      } else {
        const trail = highest(candles4H, 30, 1) + atrVal * 3.0;
        trade.sl = Math.min(trade.sl, trail);
        if (candle.high >= trade.sl) {
          signals.push({
            symbol: state.symbol,
            strategy: 'LEVIATHAN',
            action: 'CLOSE_SHORT',
            stopLoss: trade.sl,
            takeProfit: trade.entryPrice * 0.5,
            positionSizeUsd: trade.positionSize,
            reason: `Leviathan trailing SL hit at ${trade.sl.toFixed(2)}`,
          });
          state.leviathanTrade = null;
        }
      }
    } else {
      // Entry signals
      const bullSignal = ema50 > ema200 && rsiVal > 45 && rsiVal < 72 && candle.close > high20;
      const bearSignal = ema50 < ema200 && rsiVal < 55 && rsiVal > 28 && candle.close < low20;

      if (bullSignal) {
        const sl = lowest(candles4H, 30, 1) - atrVal * 3.0;
        const riskDist = Math.max(Math.abs(candle.close - sl) / candle.close, 0.01);
        const riskAmount = accountBalance * 0.05;
        const desired = riskAmount / riskDist;
        const maxAllowed = Math.min(leviathanCapital * 2, Math.max(0, maxAllowedMargin - totalMarginUsed));
        const posSize = Math.min(desired, maxAllowed);

        if (posSize >= 50) {
          const entryPrice = candle.close * (1 + SLIPPAGE);
          state.leviathanTrade = { action: 'BUY', entryPrice, sl, positionSize: posSize, partialTaken: false };
          totalMarginUsed += posSize;
          signals.push({
            symbol: state.symbol,
            strategy: 'LEVIATHAN',
            action: 'OPEN_LONG',
            stopLoss: sl,
            takeProfit: candle.close * 1.40,
            positionSizeUsd: posSize,
            reason: `Leviathan LONG: EMA50>${ema50.toFixed(0)} EMA200, RSI=${rsiVal.toFixed(1)}, BO above ${high20.toFixed(2)}`,
          });
        }
      } else if (bearSignal) {
        const sl = highest(candles4H, 30, 1) + atrVal * 3.0;
        const riskDist = Math.max(Math.abs(sl - candle.close) / candle.close, 0.01);
        const riskAmount = accountBalance * 0.05;
        const desired = riskAmount / riskDist;
        const maxAllowed = Math.min(leviathanCapital * 2, Math.max(0, maxAllowedMargin - totalMarginUsed));
        const posSize = Math.min(desired, maxAllowed);

        if (posSize >= 50) {
          const entryPrice = candle.close * (1 - SLIPPAGE);
          state.leviathanTrade = { action: 'SELL', entryPrice, sl, positionSize: posSize, partialTaken: false };
          totalMarginUsed += posSize;
          signals.push({
            symbol: state.symbol,
            strategy: 'LEVIATHAN',
            action: 'OPEN_SHORT',
            stopLoss: sl,
            takeProfit: candle.close * 0.60,
            positionSizeUsd: posSize,
            reason: `Leviathan SHORT: EMA50<EMA200, RSI=${rsiVal.toFixed(1)}, BO below ${low20.toFixed(2)}`,
          });
        }
      }
    }
  }

  // ── 4. MEGALODON ─────────────────────────────────────────────────────────
  if (candles4H.length > 800) {
    const ema800 = ema(candles4H, 800);
    const atrVal = atr(candles4H, 14);

    if (state.megalodonTrade) {
      const trade = state.megalodonTrade;
      if (trade.action === 'BUY') {
        const trail = ema800 - atrVal * 3;
        trade.sl = Math.max(trade.sl, trail);
        if (candle.low <= trade.sl) {
          signals.push({
            symbol: state.symbol,
            strategy: 'MEGALODON',
            action: 'CLOSE_LONG',
            stopLoss: trade.sl,
            takeProfit: candle.close * 2,
            positionSizeUsd: trade.positionSize,
            reason: `Megalodon LONG exit: SL ${trade.sl.toFixed(2)} hit`,
          });
          state.megalodonTrade = null;
          const exitPrice = Math.min(trade.sl, candle.open) * (1 - SLIPPAGE);
          const lossPct = (trade.entryPrice - exitPrice) / trade.entryPrice;
          if (lossPct > 0.02) {
            state.megalodonCooldownUntil = now + 80 * 3600 * 1000;
          } else {
            state.megalodonCooldownUntil = now + 20 * 3600 * 1000;
          }
        }
      } else {
        const trail = ema800 + atrVal * 3;
        trade.sl = Math.min(trade.sl, trail);
        if (candle.high >= trade.sl) {
          signals.push({
            symbol: state.symbol,
            strategy: 'MEGALODON',
            action: 'CLOSE_SHORT',
            stopLoss: trade.sl,
            takeProfit: candle.close * 0.5,
            positionSizeUsd: trade.positionSize,
            reason: `Megalodon SHORT exit: SL ${trade.sl.toFixed(2)} hit`,
          });
          state.megalodonTrade = null;
          const exitPrice = Math.max(trade.sl, candle.open) * (1 + SLIPPAGE);
          const lossPct = (exitPrice - trade.entryPrice) / trade.entryPrice;
          if (lossPct > 0.02) {
            state.megalodonCooldownUntil = now + 80 * 3600 * 1000;
          } else {
            state.megalodonCooldownUntil = now + 20 * 3600 * 1000;
          }
        }
      }
    } else if (now > state.megalodonCooldownUntil) {
      if (candle.close > ema800 * 1.02) {
        const sl = ema800 - atrVal * 3;
        const riskDist = Math.max(Math.abs(candle.close - sl) / candle.close, 0.01);
        const desired = (accountBalance * 0.03) / riskDist;
        const maxAllowed = Math.min(megalodonCapital * 2, Math.max(0, maxAllowedMargin - totalMarginUsed));
        const posSize = Math.min(desired, maxAllowed);

        if (posSize >= 50) {
          state.megalodonTrade = { action: 'BUY', entryPrice: candle.close, sl, positionSize: posSize };
          signals.push({
            symbol: state.symbol,
            strategy: 'MEGALODON',
            action: 'OPEN_LONG',
            stopLoss: sl,
            takeProfit: candle.close * 2,
            positionSizeUsd: posSize,
            reason: `Megalodon LONG: price ${candle.close.toFixed(2)} > EMA800 ${ema800.toFixed(2)}`,
          });
        }
      } else if (candle.close < ema800 * 0.98) {
        const sl = ema800 + atrVal * 3;
        const riskDist = Math.max(Math.abs(sl - candle.close) / candle.close, 0.01);
        const desired = (accountBalance * 0.03) / riskDist;
        const maxAllowed = Math.min(megalodonCapital * 2, Math.max(0, maxAllowedMargin - totalMarginUsed));
        const posSize = Math.min(desired, maxAllowed);

        if (posSize >= 50) {
          state.megalodonTrade = { action: 'SELL', entryPrice: candle.close, sl, positionSize: posSize };
          signals.push({
            symbol: state.symbol,
            strategy: 'MEGALODON',
            action: 'OPEN_SHORT',
            stopLoss: sl,
            takeProfit: candle.close * 0.5,
            positionSizeUsd: posSize,
            reason: `Megalodon SHORT: price ${candle.close.toFixed(2)} < EMA800 ${ema800.toFixed(2)}`,
          });
        }
      }
    }
  }

  return { state, signals };
}
