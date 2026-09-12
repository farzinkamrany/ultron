import ccxt from 'ccxt';

export interface DerivativesAnalysis {
  fundingRate: number;
  openInterest: number;
  sentiment: string;
  btcDominanceTrend?: 'UP' | 'DOWN' | 'FLAT';
}

/**
 * Connects to the Futures market to fetch Leverage and Funding Rate data.
 * Used for Liquidation Snipping (Short/Long Squeezes).
 */
export async function analyzeDerivatives(asset: string): Promise<DerivativesAnalysis> {
  let fundingRate = 0;
  let openInterest = 0;
  let sentiment = "Neutral";
  let btcDominanceTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';

  try {
    const exchange = new ccxt.bybit({ 
      enableRateLimit: true,
      options: { defaultType: 'future' }
    });

    // Usually spot assets are 'BTC/USDT', for Binance Futures we can usually use the same symbol
    // if 'defaultType: future' is set, CCXT handles the mapping to 'BTC/USDT:USDT'.
    
    try {
      const frData = await exchange.fetchFundingRate(asset);
      fundingRate = frData.fundingRate || 0;
    } catch (e) {
      console.warn(`Could not fetch funding rate for ${asset}`, e);
    }

    try {
      const oiData = await exchange.fetchOpenInterest(asset);
      openInterest = oiData.openInterestAmount || 0;
    } catch (e) {
      console.warn(`Could not fetch open interest for ${asset}`, e);
    }

    // Funding Rate Analysis
    // Positive FR = Longs pay Shorts (Retail is heavily Bullish/Over-leveraged)
    // Negative FR = Shorts pay Longs (Retail is heavily Bearish/Panic Shorting)
    if (fundingRate > 0.0003) { // 0.03% per 8h
      sentiment = "EXTREME RETAIL LONGS (Risk of Long Squeeze / Dump)";
    } else if (fundingRate > 0.0001) {
      sentiment = "MILD RETAIL LONGS";
    } else if (fundingRate < -0.0003) {
      sentiment = "EXTREME RETAIL SHORTS (Prime for Short Squeeze / Pump)";
    } else if (fundingRate < -0.0001) {
      sentiment = "MILD RETAIL SHORTS";
    } else {
      sentiment = "BALANCED";
    }

    // Fetching BTC Dominance Trend via Binance BTCDOM index
    try {
      const binance = new ccxt.binance({ enableRateLimit: true, options: { defaultType: 'future' } });
      const domData = await binance.fetchOHLCV('BTCDOM/USDT', '1h', undefined, 2);
      if (domData && domData.length >= 2) {
        const prevClose = domData[0][4] as number;
        const currentClose = domData[1][4] as number;
        if (currentClose > prevClose * 1.002) btcDominanceTrend = 'UP';
        else if (currentClose < prevClose * 0.998) btcDominanceTrend = 'DOWN';
      }
    } catch (e) {
      console.warn('Could not fetch BTCDOM index', e);
    }

  } catch (err) {
    console.error("Derivatives Engine Error:", err);
  }

  return {
    fundingRate,
    openInterest,
    sentiment,
    btcDominanceTrend
  };
}
