export interface OrderBookData {
  bids: [number, number][]; // [price, amount]
  asks: [number, number][];
}

export interface OrderBookAnalysis {
  totalBidVolumeUSD: number;
  totalAskVolumeUSD: number;
  imbalanceRatio: number; // > 1 means more buyers (Bullish), < 1 means more sellers (Bearish)
  whaleBuyWallPrice: number;
  whaleBuyWallVolumeUSD: number;
  whaleSellWallPrice: number;
  whaleSellWallVolumeUSD: number;
}

/**
 * Scans the Level 2 Order Book (X-Ray Scanner) to find Whale Walls and liquidity imbalance.
 */
export function analyzeOrderBook(ob: OrderBookData): OrderBookAnalysis {
  let totalBidVolumeUSD = 0;
  let totalAskVolumeUSD = 0;

  let maxBidVolumeUSD = 0;
  let whaleBuyWallPrice = 0;

  let maxAskVolumeUSD = 0;
  let whaleSellWallPrice = 0;

  // Process Bids (Buyers)
  for (const bid of ob.bids) {
    const price = bid[0];
    const amount = bid[1];
    const volumeUSD = price * amount;
    
    totalBidVolumeUSD += volumeUSD;
    
    if (volumeUSD > maxBidVolumeUSD) {
      maxBidVolumeUSD = volumeUSD;
      whaleBuyWallPrice = price;
    }
  }

  // Process Asks (Sellers)
  for (const ask of ob.asks) {
    const price = ask[0];
    const amount = ask[1];
    const volumeUSD = price * amount;
    
    totalAskVolumeUSD += volumeUSD;
    
    if (volumeUSD > maxAskVolumeUSD) {
      maxAskVolumeUSD = volumeUSD;
      whaleSellWallPrice = price;
    }
  }

  // Imbalance: Bids / Asks. 
  // e.g. Ratio 2.0 means 2x more buy orders than sell orders.
  const imbalanceRatio = totalAskVolumeUSD > 0 ? (totalBidVolumeUSD / totalAskVolumeUSD) : 1;

  return {
    totalBidVolumeUSD,
    totalAskVolumeUSD,
    imbalanceRatio,
    whaleBuyWallPrice,
    whaleBuyWallVolumeUSD: maxBidVolumeUSD,
    whaleSellWallPrice,
    whaleSellWallVolumeUSD: maxAskVolumeUSD
  };
}
