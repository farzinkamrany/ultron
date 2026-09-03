import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from './gann';

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
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
}

/**
 * Scans the top altcoins to find one that can hit the target profit percentage.
 * Performs a "Fast Pass" checking Gann Supports/Resistances to avoid rate limits.
 */
export async function huntForSetup(targetProfitPerc: number): Promise<HuntTrade | null> {
  const exchange = new ccxt.bybit({ enableRateLimit: true });

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

      const targetDistancePerc = ((closestResistance - currentPrice) / currentPrice) * 100;
      const distanceToSupportPerc = ((currentPrice - closestSupport) / currentPrice) * 100;

      if (targetDistancePerc >= targetProfitPerc && distanceToSupportPerc <= 4.0) {
        const score = targetDistancePerc - distanceToSupportPerc;
        if (score > bestScore) {
          bestScore = score;
          bestTrade = {
            symbol: asset,
            entryPrice: currentPrice,
            targetPrice: closestResistance,
            stopLoss: closestSupport * 0.99
          };
        }
      }
    }
  } catch (err) {
    console.error("Hunter: Batch fetch failed", err);
  }

  return bestTrade;
}
