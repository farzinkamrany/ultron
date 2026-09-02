import ccxt from 'ccxt';
import { HttpsProxyAgent } from 'https-proxy-agent';
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
  const exchangeOpts: any = { enableRateLimit: true };
  if (proxyUrl) {
    exchangeOpts.agent = new HttpsProxyAgent(proxyUrl);
  }
  const exchange = new ccxt.binance(exchangeOpts);

  let bestTrade: HuntTrade | null = null;
  let bestScore = -1000;

  const promises = TOP_ALTCOINS.map(async (asset) => {
    try {
      const ticker = await exchange.fetchTicker(asset);
      const currentPrice = ticker.last || 0;
      if (currentPrice === 0) return;

      const { supports, resistances } = calculateGannSquareOf9(currentPrice);
      
      let closestSupport = 0;
      for (const s of supports) {
        if (currentPrice >= s) { closestSupport = s; break; }
      }

      let closestResistance = Infinity;
      for (const r of resistances) {
        if (r >= currentPrice) { closestResistance = r; break; }
      }

      if (closestSupport === 0 || closestResistance === Infinity) return;

      const targetDistancePerc = ((closestResistance - currentPrice) / currentPrice) * 100;
      const distanceToSupportPerc = ((currentPrice - closestSupport) / currentPrice) * 100;

      if (targetDistancePerc >= targetProfitPerc && distanceToSupportPerc <= 4.0) {
        const score = targetDistancePerc - distanceToSupportPerc;
        return {
          symbol: asset,
          entryPrice: currentPrice,
          targetPrice: closestResistance,
          stopLoss: closestSupport * 0.99,
          score
        };
      }
    } catch (err) {
      console.warn(`Hunter: Failed to scan ${asset}`, err);
    }
  });

  const results = await Promise.all(promises);
  
  for (const res of results) {
    if (res && res.score > bestScore) {
      bestScore = res.score;
      bestTrade = {
        symbol: res.symbol,
        entryPrice: res.entryPrice,
        targetPrice: res.targetPrice,
        stopLoss: res.stopLoss
      };
    }
  }

  return bestTrade;
}
