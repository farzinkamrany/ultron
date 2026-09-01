import ccxt from 'ccxt';

export interface DerivativesAnalysis {
  fundingRate: number;
  openInterest: number;
  sentiment: string;
}

/**
 * Connects to the Futures market to fetch Leverage and Funding Rate data.
 * Used for Liquidation Snipping (Short/Long Squeezes).
 */
export async function analyzeDerivatives(asset: string): Promise<DerivativesAnalysis> {
  let fundingRate = 0;
  let openInterest = 0;
  let sentiment = "Neutral";

  try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    
    // Connect to Binance Futures (USDT-M)
    const exchange = new ccxt.binance({ 
      enableRateLimit: true,
      options: { defaultType: 'future' }
    });
    
    if (proxyUrl) {
      exchange.httpsProxy = proxyUrl;
    }

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

  } catch (err) {
    console.error("Derivatives Engine Error:", err);
  }

  return {
    fundingRate,
    openInterest,
    sentiment
  };
}
