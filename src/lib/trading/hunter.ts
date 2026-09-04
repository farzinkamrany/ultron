import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from './gann';
import { redis } from '../redis';
import { CTOConfig } from '../ai';

const TOP_ALTCOINS = [
  // Top 50 Liquid Altcoins on Binance/Bybit
  // 'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT',
  // 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'MATIC/USDT', 'DOT/USDT',
  // 'DOGE/USDT', 'SHIB/USDT', 'LTC/USDT', 'ATOM/USDT', 'UNI/USDT',
  // 'NEAR/USDT', 'APT/USDT', 'INJ/USDT', 'OP/USDT', 'ARB/USDT',
  // 'TON/USDT', 'BCH/USDT', 'TRX/USDT', 'ICP/USDT', 'XLM/USDT',
  // 'FIL/USDT', 'RNDR/USDT', 'STX/USDT', 'MKR/USDT', 'VET/USDT',
  // 'GRT/USDT', 'THETA/USDT', 'AAVE/USDT', 'LDO/USDT', 'SNX/USDT',
  // 'CRV/USDT', 'SAND/USDT', 'MANA/USDT', 'AXS/USDT', 'GALA/USDT',
  // 'ALGO/USDT', 'EGLD/USDT', 'FTM/USDT', 'QNT/USDT', 'XTZ/USDT',
  // 'HBAR/USDT', 'EOS/USDT', 'ZEC/USDT', 'DASH/USDT', 'PEPE/USDT'
  'BTC/USDT' // Beast Mode: Locked to BTC on 15m timeframe for maximum aggressive compounding
];

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
    // === FAST PASS: GANN & R:R FILTER ===
    const tickers = await exchange.fetchTickers(TOP_ALTCOINS);
    const candidates: any[] = [];

    for (const asset of TOP_ALTCOINS) {
      const ticker = tickers[asset];
      if (!ticker) continue;
      const currentPrice = ticker.last || 0;
      if (currentPrice === 0) continue;

      const { supports, resistances } = calculateGannSquareOf9(currentPrice);

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
        // Fetch 15m candles. We need enough candles to check liquidity sweeps based on CTO's lookback
        const ohlcv = await exchange.fetchOHLCV(candidate.asset, '15m', undefined, smcLookback + 5);
        if (!ohlcv || ohlcv.length === 0) continue;

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
          const validOB = obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity);
          if (validOB) {
            bestTrade = {
              symbol: candidate.asset,
              action: 'BUY',
              entryPrice: candidate.currentPrice,
              targetPrice: candidate.tp,
              stopLoss: candidate.sl,
              execution_context: `R:R=${candidate.rr.toFixed(2)} | GannSL=${candidate.sl.toFixed(4)} | GannTP=${candidate.tp.toFixed(4)} | SMC=Bullish_OB_Swept`
            };
            break; // Found the best trade, stop checking
          }
        } else {
          const validOB = obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity);
          if (validOB) {
            bestTrade = {
              symbol: candidate.asset,
              action: 'SELL',
              entryPrice: candidate.currentPrice,
              targetPrice: candidate.tp,
              stopLoss: candidate.sl,
              execution_context: `R:R=${candidate.rr.toFixed(2)} | GannSL=${candidate.sl.toFixed(4)} | GannTP=${candidate.tp.toFixed(4)} | SMC=Bearish_OB_Swept`
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
