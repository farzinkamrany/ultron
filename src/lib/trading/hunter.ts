import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from './gann';

const TOP_ALTCOINS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT',
  'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'MATIC/USDT', 'DOT/USDT',
  'DOGE/USDT', 'SHIB/USDT', 'LTC/USDT', 'ATOM/USDT', 'UNI/USDT',
  'NEAR/USDT', 'APT/USDT', 'INJ/USDT', 'OP/USDT', 'ARB/USDT'
];

export interface HuntResult {
  symbol: string;
  targetDistancePerc: number;
  distanceToSupportPerc: number;
  passed: boolean;
}

export interface HuntTrade {
  symbol: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
}

/**
 * Scans the top altcoins to find one that can hit the target profit percentage.
 * Performs a "Fast Pass" checking Gann Supports/Resistances to avoid rate limits.
 */
export async function huntForSetup(targetProfitPerc: number): Promise<HuntTrade | null> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const exchange = new ccxt.binance({ enableRateLimit: true });
  
  if (proxyUrl) {
    exchange.httpsProxy = proxyUrl;
  }

  let bestTrade: HuntTrade | null = null;
  let bestScore = -1000;

  for (const asset of TOP_ALTCOINS) {
    try {
      const ticker = await exchange.fetchTicker(asset);
      const currentPrice = ticker.last || 0;
      if (currentPrice === 0) continue;

      const { supports, resistances } = calculateGannSquareOf9(currentPrice);
      
      // Find the closest support below current price
      let closestSupport = 0;
      for (const s of supports) {
        if (currentPrice >= s) {
          closestSupport = s;
          break; // Supports are ordered closest to farthest
        }
      }

      // Find the closest resistance above current price
      let closestResistance = Infinity;
      for (const r of resistances) {
        if (r >= currentPrice) {
          closestResistance = r;
          break;
        }
      }

      if (closestSupport === 0 || closestResistance === Infinity) continue;

      const targetDistancePerc = ((closestResistance - currentPrice) / currentPrice) * 100;
      const distanceToSupportPerc = ((currentPrice - closestSupport) / currentPrice) * 100;

      // Rule 1: Can it hit the target profit?
      if (targetDistancePerc >= targetProfitPerc) {
        // Rule 2: Is it close enough to a support to be a safe buy? (Within 4% of a Gann Support)
        if (distanceToSupportPerc <= 4.0) {
          // Score = high target potential - distance to support (we want highest target, lowest risk)
          const score = targetDistancePerc - distanceToSupportPerc;
          if (score > bestScore) {
            bestScore = score;
            bestTrade = {
              symbol: asset,
              entryPrice: currentPrice,
              targetPrice: closestResistance,
              stopLoss: closestSupport * 0.99 // SL is 1% below the immediate Gann Support
            };
          }
        }
      }

      // Small delay to avoid API rate limits
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (err) {
      console.warn(`Hunter: Failed to scan ${asset}`, err);
    }
  }

  return bestTrade;
}
