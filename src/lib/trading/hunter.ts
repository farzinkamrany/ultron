import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from './gann';
import { redis } from '../redis';
import { CTOConfig } from '../ai';

const TOP_ALTCOINS = [
  // Top 50 Liquid Altcoins on Binance/Bybit
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT',
  'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'MATIC/USDT', 'DOT/USDT',
  'DOGE/USDT', 'SHIB/USDT', 'LTC/USDT', 'ATOM/USDT', 'UNI/USDT',
  'NEAR/USDT', 'APT/USDT', 'INJ/USDT', 'OP/USDT', 'ARB/USDT',
  'TON/USDT', 'BCH/USDT', 'TRX/USDT', 'ICP/USDT', 'XLM/USDT',
  'FIL/USDT', 'RNDR/USDT', 'STX/USDT', 'MKR/USDT', 'VET/USDT',
  'GRT/USDT', 'THETA/USDT', 'AAVE/USDT', 'LDO/USDT', 'SNX/USDT',
  'CRV/USDT', 'SAND/USDT', 'MANA/USDT', 'AXS/USDT', 'GALA/USDT',
  'ALGO/USDT', 'EGLD/USDT', 'FTM/USDT', 'QNT/USDT', 'XTZ/USDT',
  'HBAR/USDT', 'EOS/USDT', 'ZEC/USDT', 'DASH/USDT', 'PEPE/USDT'
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

  const targetProfitPerc = ctoConfig?.target_profit_pct || fallbackTargetProfitPerc;
  const maxDistanceToSupport = ctoConfig?.gann_tolerance_pct ? ctoConfig.gann_tolerance_pct * 100 : 0.3; // Default 0.3%

  let bestTrade: HuntTrade | null = null;
  let bestScore = -1000;

  try {
    const tickers = await exchange.fetchTickers(TOP_ALTCOINS);
    
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

      const distanceUpPerc = ((closestResistance - currentPrice) / currentPrice) * 100;
      const distanceDownPerc = ((currentPrice - closestSupport) / currentPrice) * 100;

      // Evaluate LONG setup
      if (distanceUpPerc >= targetProfitPerc && distanceDownPerc <= maxDistanceToSupport) {
        const score = distanceUpPerc - distanceDownPerc;
        if (score > bestScore) {
          bestScore = score;
          bestTrade = {
            symbol: asset,
            action: 'BUY',
            entryPrice: currentPrice,
            targetPrice: closestResistance,
            stopLoss: closestSupport * 0.99
          };
        }
      }

      // Evaluate SHORT setup
      if (distanceDownPerc >= targetProfitPerc && distanceUpPerc <= maxDistanceToSupport) {
        const score = distanceDownPerc - distanceUpPerc;
        if (score > bestScore) {
          bestScore = score;
          bestTrade = {
            symbol: asset,
            action: 'SELL',
            entryPrice: currentPrice,
            targetPrice: closestSupport, // For short, target is the support
            stopLoss: closestResistance * 1.01 // For short, SL is above resistance
          };
        }
      }
    }
  } catch (err) {
    console.error("Hunter: Batch fetch failed", err);
  }

  return bestTrade;
}
