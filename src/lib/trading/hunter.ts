import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from './gann';
import { redis } from '../redis';
import { CTOConfig } from '../ai';

import { detectMarketRegime } from './risk';

// ============ PHASE 1: SNOWBALL (15m) - ETH Only (Best Risk/Reward) ============
const BEAST_MODE_SYMBOLS = ['ETH/USDT'];
const BEAST_MODE_TF = '15m';

// ============ PHASE 2: SNIPER (1h) - Multi-asset ============
const SHIELD_MODE_SYMBOLS = ['BTC/USDT', 'ETH/USDT'];
const SHIELD_MODE_TF = '1h';

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
export async function huntForSetup(fallbackTargetProfitPerc: number): Promise<HuntTrade | null> {
  const exchange = new ccxt.bybit({ enableRateLimit: true });

  // 1. Fetch CTO Config
  let ctoConfig: CTOConfig | null = null;
  try {
    const configStr = await redis.get('ul_cto_config') as string | null;
    if (configStr) ctoConfig = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
  } catch (err) {
    console.error("Redis fetch failed, using fallback config.");
  }

  const slBuffer = ctoConfig?.gann_tolerance_pct || 0.003; // Dynamic Stop-Loss buffer
  const smcLookback = ctoConfig?.smc_lookback_candles || 5;

  let bestTrade: HuntTrade | null = null;

  try {
    // === AUTONOMOUS REGIME DETECTION ===
    // We check the macro regime on BTC to decide the market mood.
    const regime = await detectMarketRegime('BTC/USDT');
    const activeAssets = regime === 'CALM' ? BEAST_MODE_SYMBOLS : SHIELD_MODE_SYMBOLS;
    const targetTF = regime === 'CALM' ? BEAST_MODE_TF : SHIELD_MODE_TF;

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
        candidates.push({ asset, action: 'BUY', currentPrice, tp: longTP, sl: longSL, rr: longRR });
      } else if (shortRR >= 2.0 && distanceToResPerc <= slBuffer) {
        candidates.push({ asset, action: 'SELL', currentPrice, tp: shortTP, sl: shortSL, rr: shortRR });
      }
    }

    // Sort candidates by highest R:R ratio
    candidates.sort((a, b) => b.rr - a.rr);

    // === DEEP PASS: SMC VALIDATION ===
    for (const candidate of candidates) {
      try {
        // Fetch dynamic timeframe candles based on the regime
        const ohlcv = await exchange.fetchOHLCV(candidate.asset, targetTF, undefined, smcLookback + 5);
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

        const candles = ohlcv.map(c => ({
          timestamp: c[0] as number,
          open: c[1] as number,
          high: c[2] as number,
          low: c[3] as number,
          close: c[4] as number,
          volume: c[5] as number
        }));

        const { findOrderBlocks } = await import('./ict');
        const obs = findOrderBlocks(candles);

        if (candidate.action === 'BUY') {
          if (downwardAngles.position.includes('BELOW 2x1')) {
            console.log(`[Hunter] Rejected ${candidate.asset} BUY: Freefall downward angle.`);
            continue;
          }
          if (upwardAngles.position.includes('ABOVE')) gannContext += ' | Upward Gann Angle';
          if (isReversalWindow) gannContext += ' | TIME REVERSAL';
          if (cosmos.planetaryAspect) gannContext += ` | ${cosmos.planetaryAspect}`;

          const validOB = obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && candidate.currentPrice <= ob.top * 1.001 && candidate.currentPrice >= ob.bottom * 0.999);
          if (validOB) {
            bestTrade = {
              symbol: candidate.asset,
              action: 'BUY',
              entryPrice: candidate.currentPrice,
              targetPrice: candidate.tp,
              stopLoss: candidate.sl,
              execution_context: `R:R=${candidate.rr.toFixed(2)} | SMC_OB_Swept_Mitigated${gannContext}`
            };
            break; // Found the best trade, stop checking
          }
        } else {
          if (upwardAngles.position.includes('ABOVE 2x1')) {
            console.log(`[Hunter] Rejected ${candidate.asset} SELL: Extreme Bullish upward angle.`);
            continue;
          }
          if (downwardAngles.position.includes('BELOW')) gannContext += ' | Downward Gann Angle';
          if (isReversalWindow) gannContext += ' | TIME REVERSAL';
          if (cosmos.planetaryAspect) gannContext += ` | ${cosmos.planetaryAspect}`;

          const validOB = obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && candidate.currentPrice >= ob.bottom * 0.999 && candidate.currentPrice <= ob.top * 1.001);
          if (validOB) {
            bestTrade = {
              symbol: candidate.asset,
              action: 'SELL',
              entryPrice: candidate.currentPrice,
              targetPrice: candidate.tp,
              stopLoss: candidate.sl,
              execution_context: `R:R=${candidate.rr.toFixed(2)} | SMC_OB_Swept_Mitigated${gannContext}`
            };
            break; // Found the best trade, stop checking
          }
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
