import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from './gann';
import { redis } from '../redis';
import { supabase } from '../supabase';
import { CTOConfig } from '../ai';

import { detectMarketRegime } from './risk';
import { calculateChoppinessIndex } from './financial-intelligence';

// ============ PHASE 1: SNOWBALL (15m) - Maximum Volatility (Best Risk/Reward) ============
const BEAST_MODE_SYMBOLS = ['BTC/USDC:USDC', 'ETH/USDC:USDC', 'SOL/USDC:USDC', 'LINK/USDC:USDC', 'ADA/USDC:USDC', 'BNB/USDC:USDC', 'XRP/USDC:USDC', 'DOGE/USDC:USDC', 'AVAX/USDC:USDC', 'DOT/USDC:USDC'];
const BEAST_MODE_TF = '15m';

export interface HuntResult {
  symbol: string;
  targetDistancePerc: number;
  distanceToSupportPerc: number;
  passed: boolean;
}

export interface HuntTrade {
  symbol: string;
  action: 'BUY' | 'SELL';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  execution_context: string;
}

/**
 * Scans the top altcoins to find one that can hit the target profit percentage.
 * Performs a "Fast Pass" checking Gann Supports/Resistances to avoid rate limits.
 */
export async function huntForSetup(fallbackTargetProfitPerc: number, openSymbols: string[] = []): Promise<HuntTrade | null> {
  const exchange = new ccxt.hyperliquid({ enableRateLimit: true });

  // 1. Fetch CTO Config
  let ctoConfig: CTOConfig | null = null;
  try {
    const configStr = await redis.get('ul_cto_config') as string | null;
    if (configStr) ctoConfig = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
  } catch (err) {
    console.error("Redis fetch failed, using fallback config.");
  }
  
  // === SESSION FILTER (WEEKEND BAN) ===
  const today = new Date().getUTCDay();
  if (today === 0 || today === 6) {
      console.log(`[Hunter] Halting hunt: Weekend detected (Day ${today}). No new entries allowed.`);
      return null;
  }
  
  // === SMART CIRCUIT BREAKER CHECK ===
  let isCircuitBreakerActive = false;
  try {
      const { data: recentTrades } = await supabase
          .from('trades')
          .select('pnl')
          .eq('status', 'CLOSED')
          .order('closed_at', { ascending: false })
          .limit(3);
          
      if (recentTrades && recentTrades.length === 3) {
          const allLosses = recentTrades.every(t => t.pnl !== null && t.pnl < 0);
          if (allLosses) isCircuitBreakerActive = true;
      }
  } catch (err) {
      console.error("[Hunter] Failed to check recent trades for Circuit Breaker", err);
  }

  const slBuffer = ctoConfig?.gann_tolerance_pct || 0.015; // Widen initial tolerance to 1.5% for volatile altcoins
  const smcLookback = ctoConfig?.smc_lookback_candles || 5;

  let bestTrade: HuntTrade | null = null;

  try {
    // We check the macro regime strictly for database context, but NEVER retreat. 
    // The Backtest proved 15m fat-tail trailing stops thrive in WILD markets.
    const regime = await detectMarketRegime('BTC/USDT');
    const activeAssets = BEAST_MODE_SYMBOLS.filter(sym => !openSymbols.includes(sym));
    const targetTF = BEAST_MODE_TF;

    // === FAST PASS: GANN & R:R FILTER ===
    const tickers = await exchange.fetchTickers(activeAssets);
    const candidates: any[] = [];

    for (const asset of activeAssets) {
      const ticker = tickers[asset];
      if (!ticker) continue;
      const currentPrice = ticker.last || 0;
      if (currentPrice === 0) continue;

      const { supports, resistances } = calculateGannSquareOf9(currentPrice, currentPrice);

      let closestSupport = 0;
      for (const s of supports) {
        if (currentPrice >= s) { closestSupport = s; break; }
      }

      let closestResistance = Infinity;
      for (const r of resistances) {
        if (r >= currentPrice) { closestResistance = r; break; }
      }

      if (closestSupport === 0 || closestResistance === Infinity) continue;

      // Check LONG math
      const longTP = closestResistance;
      const longSL = closestSupport * (1 - slBuffer);
      const longRR = (longTP - currentPrice) / (currentPrice - longSL);

      // Check SHORT math
      const shortTP = closestSupport;
      const shortSL = closestResistance * (1 + slBuffer);
      const shortRR = (currentPrice - shortTP) / (shortSL - currentPrice);

      // Tolerance check: is price currently bouncing off support or resistance?
      const distanceToSupportPerc = (currentPrice - closestSupport) / currentPrice;
      const distanceToResPerc = (closestResistance - currentPrice) / currentPrice;

      if (longRR >= 2.0 && distanceToSupportPerc <= slBuffer) {
        candidates.push({ asset, action: 'BUY', currentPrice, tp: longTP, sl: longSL, rr: longRR, closestSupport, closestResistance });
      } else if (shortRR >= 2.0 && distanceToResPerc <= slBuffer) {
        candidates.push({ asset, action: 'SELL', currentPrice, tp: shortTP, sl: shortSL, rr: shortRR, closestSupport, closestResistance });
      }
    }

    // Sort candidates by highest R:R ratio
    candidates.sort((a, b) => b.rr - a.rr);

    // === DEEP PASS: SMC VALIDATION ===
    for (const candidate of candidates) {
      try {
        // Fetch dynamic timeframe candles based on the regime
        // Increased from 250 to 850 to calculate EMA 800 (4H Macro Trend)
        const ohlcv = await exchange.fetchOHLCV(candidate.asset, targetTF, undefined, 850);
        if (!ohlcv || ohlcv.length === 0) continue;

        let macroOhlcv;
        try { macroOhlcv = await exchange.fetchOHLCV(candidate.asset, '1d', undefined, 365); } 
        catch (err) { macroOhlcv = ohlcv; }

        let absoluteLow = Infinity;
        let absoluteHigh = -Infinity;
        let pivotTimestamp = 0;
        let highTimestamp = 0;

        for (const c of macroOhlcv) {
          const timestamp = c[0] as number;
          const high = c[2] as number;
          const low = c[3] as number;
          if (low < absoluteLow) { absoluteLow = low; pivotTimestamp = timestamp; }
          if (high > absoluteHigh) { absoluteHigh = high; highTimestamp = timestamp; }
        }

        const trueScaleFactor = (absoluteHigh - absoluteLow) / 365;
        const daysSincePivot = Math.floor((Date.now() - pivotTimestamp) / (1000 * 60 * 60 * 24));
        const daysSinceHigh = Math.floor((Date.now() - highTimestamp) / (1000 * 60 * 60 * 24));

        const { calculateGannAngles, calculateDownwardGannAngles, calculateTimeCycles, calculateCosmicAlignment } = await import('./gann');
        const upwardAngles = calculateGannAngles(absoluteLow, daysSincePivot, candidate.currentPrice, trueScaleFactor);
        const downwardAngles = calculateDownwardGannAngles(absoluteHigh, daysSinceHigh, candidate.currentPrice, trueScaleFactor);
        const { isReversalWindow } = calculateTimeCycles(daysSincePivot);
        const cosmos = calculateCosmicAlignment(candidate.currentPrice);

        let gannContext = '';

        const closes = ohlcv.map(c => c[4] as number);
        let ema800 = closes[0];
        let ema672 = closes[0];
        if (closes.length >= 800) {
            ema800 = closes.slice(0, 800).reduce((a, b) => a + b, 0) / 800;
            const k = 2 / (800 + 1);
            for (let i = 800; i < closes.length; i++) {
                ema800 = (closes[i] * k) + (ema800 * (1 - k));
            }
        }
        if (closes.length >= 672) {
            ema672 = closes.slice(0, 672).reduce((a, b) => a + b, 0) / 672;
            const k = 2 / (672 + 1);
            for (let i = 672; i < closes.length; i++) {
                ema672 = (closes[i] * k) + (ema672 * (1 - k));
            }
        }
        const trend = closes.length >= 800 ? (candidate.currentPrice > ema800 ? 'UP' : 'DOWN') : 'UNKNOWN';

        const candles = ohlcv.map(c => ({
          timestamp: c[0] as number,
          open: c[1] as number,
          high: c[2] as number,
          low: c[3] as number,
          close: c[4] as number,
          volume: c[5] as number
        }));
        
        // === SMART CIRCUIT BREAKER (Wait for Chop to end) ===
        if (isCircuitBreakerActive) {
            const chop = calculateChoppinessIndex(candles, 288);
            if (chop > 50) {
                console.log(`[Hunter] Smart Circuit Breaker ACTIVE for ${candidate.asset}: Market is choppy (Chop: ${chop.toFixed(1)}) after 3 consecutive losses. Halting.`);
                continue;
            } else {
                console.log(`[Hunter] Smart Circuit Breaker RECOVERED for ${candidate.asset}: Trend is clean (Chop: ${chop.toFixed(1)}). Resuming trade evaluation.`);
            }
        }

        let trSum = 0;
        for (let i = Math.max(1, candles.length - 14); i < candles.length; i++) {
          const c = candles[i];
          const prevC = candles[i - 1];
          const tr = Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close));
          trSum += tr;
        }
        const atr = trSum / Math.min(14, candles.length - 1);
        const atrPadding = atr * 1.5;

        // RSI & Volume Spike for Capitulation Override
        let rsi = 50;
        if (closes.length >= 15) {
            let gains = 0, losses = 0;
            for (let i = closes.length - 14; i < closes.length; i++) {
                const change = closes[i] - closes[i-1];
                if (change > 0) gains += change;
                else losses -= change;
            }
            const avgGain = gains / 14;
            const avgLoss = losses / 14;
            rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
        }
        
        let volSum = 0;
        const volPeriod = 20;
        for(let v = ohlcv.length - volPeriod; v < ohlcv.length; v++) {
            volSum += ohlcv[v][5] as number;
        }
        const avgVol = volSum / volPeriod;
        const currentVol = ohlcv[ohlcv.length - 1][5] as number;
        const volSpike = currentVol > avgVol * 3.0; // 300% volume spike

        const { findOrderBlocks } = await import('./ict');
        const obs = findOrderBlocks(candles);

        if (candidate.action === 'BUY') {
          if (trend === 'DOWN' || candidate.currentPrice < ema672) {
             if (rsi < 25 && volSpike) {
                console.log(`[Hunter] CAPITULATION OVERRIDE ${candidate.asset} BUY: Catching the knife (RSI: ${rsi.toFixed(1)}, Vol: 3x).`);
                candidate.closestSupport *= 0.99; // widen SL to survive chop
             } else {
                console.log(`[Hunter] Rejected ${candidate.asset} BUY: Counter-trend (Price below EMA 800 / EMA 672).`);
                continue;
             }
          }
          if (isReversalWindow) {
             console.log(`[Hunter] Rejected ${candidate.asset} BUY: TIME REVERSAL ACTIVE.`);
             continue;
          }
          if (downwardAngles.position.includes('BELOW 2x1')) {
            console.log(`[Hunter] Rejected ${candidate.asset} BUY: Freefall downward angle.`);
            continue;
          }

          const finalSL = candidate.closestSupport - atrPadding;
          const finalRR = (candidate.tp - candidate.currentPrice) / (candidate.currentPrice - finalSL);

          if (finalRR < 1.5) {
             console.log(`[Hunter] Rejected ${candidate.asset} BUY: R:R dropped to ${finalRR.toFixed(2)} after ATR padding.`);
             continue;
          }

          if (upwardAngles.position.includes('ABOVE')) gannContext += ' | Upward Gann Angle';
          if (cosmos.planetaryAspect) gannContext += ` | ${cosmos.planetaryAspect}`;

          const validOB = obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && !ob.mitigated && candidate.currentPrice <= ob.top * 1.001 && candidate.currentPrice >= ob.bottom * 0.999);
          if (validOB) gannContext += ' | SMC_OB_Swept_Mitigated';
          
          // Execute based on mathematical Gann edge (Matching the Backtest)
          bestTrade = {
            symbol: candidate.asset,
            action: 'BUY',
            entryPrice: candidate.currentPrice,
            targetPrice: candidate.tp,
            stopLoss: finalSL,
            execution_context: `R:R=${finalRR.toFixed(2)}${gannContext}`
          };
          break; // Found the best trade, stop checking
        } else {
          if (trend === 'UP' || candidate.currentPrice > ema672) {
             if (rsi > 75 && volSpike) {
                console.log(`[Hunter] CAPITULATION OVERRIDE ${candidate.asset} SELL: Shorting euphoria (RSI: ${rsi.toFixed(1)}, Vol: 3x).`);
                candidate.closestResistance *= 1.01; // widen SL to survive chop
             } else {
                console.log(`[Hunter] Rejected ${candidate.asset} SELL: Counter-trend (Price above EMA 800 / EMA 672).`);
                continue;
             }
          }
          if (isReversalWindow) {
             console.log(`[Hunter] Rejected ${candidate.asset} SELL: TIME REVERSAL ACTIVE.`);
             continue;
          }
          if (upwardAngles.position.includes('ABOVE 2x1')) {
            console.log(`[Hunter] Rejected ${candidate.asset} SELL: Extreme Bullish upward angle.`);
            continue;
          }

          const finalSL = candidate.closestResistance + atrPadding;
          const finalRR = (candidate.currentPrice - candidate.tp) / (finalSL - candidate.currentPrice);

          if (finalRR < 1.5) {
             console.log(`[Hunter] Rejected ${candidate.asset} SELL: R:R dropped to ${finalRR.toFixed(2)} after ATR padding.`);
             continue;
          }

          if (downwardAngles.position.includes('BELOW')) gannContext += ' | Downward Gann Angle';
          if (cosmos.planetaryAspect) gannContext += ` | ${cosmos.planetaryAspect}`;

          const validOB = obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && !ob.mitigated && candidate.currentPrice >= ob.bottom * 0.999 && candidate.currentPrice <= ob.top * 1.001);
          if (validOB) gannContext += ' | SMC_OB_Swept_Mitigated';

          // Execute based on mathematical Gann edge (Matching the Backtest)
          bestTrade = {
            symbol: candidate.asset,
            action: 'SELL',
            entryPrice: candidate.currentPrice,
            targetPrice: candidate.tp,
            stopLoss: finalSL,
            execution_context: `R:R=${finalRR.toFixed(2)}${gannContext}`
          };
          break; // Found the best trade, stop checking
        }
      } catch (err) {
        console.error(`SMC fetch failed for ${candidate.asset}`, err);
      }
    }

  } catch (err) {
    console.error("Hunter: Batch fetch failed", err);
  }

  return bestTrade;
}
