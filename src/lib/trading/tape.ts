export interface Trade {
  side: 'buy' | 'sell' | string;
  price: number;
  amount: number;
  timestamp: number;
}

export interface OrderFlowAnalysis {
  aggressiveBuyVolumeUSD: number;
  aggressiveSellVolumeUSD: number;
  cvd: number; // Cumulative Volume Delta
  cvdStatus: string; // E.g., "Aggressive Buying (FOMO)", "Aggressive Selling (Panic)"
}

/**
 * Analyzes the Tape (Recent Executed Market Orders) to detect Order Flow aggression and CVD.
 */
export function analyzeOrderFlow(trades: Trade[]): OrderFlowAnalysis {
  let aggressiveBuyVolumeUSD = 0;
  let aggressiveSellVolumeUSD = 0;

  for (const trade of trades) {
    const volumeUSD = trade.price * trade.amount;
    
    // In CCXT, side usually represents the taker side.
    // If a market buyer executes against a limit seller, side is 'buy'.
    if (trade.side === 'buy') {
      aggressiveBuyVolumeUSD += volumeUSD;
    } else if (trade.side === 'sell') {
      aggressiveSellVolumeUSD += volumeUSD;
    }
  }

  // Calculate Cumulative Volume Delta (CVD)
  const cvd = aggressiveBuyVolumeUSD - aggressiveSellVolumeUSD;

  let cvdStatus = "Neutral Flow";
  
  // Calculate relative strength
  const totalVolume = aggressiveBuyVolumeUSD + aggressiveSellVolumeUSD;
  
  if (totalVolume > 0) {
    const buyRatio = aggressiveBuyVolumeUSD / totalVolume;
    
    if (buyRatio > 0.65) {
      cvdStatus = "EXTREME AGGRESSIVE BUYING (FOMO)";
    } else if (buyRatio > 0.55) {
      cvdStatus = "MILD BUYING PRESSURE";
    } else if (buyRatio < 0.35) {
      cvdStatus = "EXTREME AGGRESSIVE SELLING (PANIC DUMP)";
    } else if (buyRatio < 0.45) {
      cvdStatus = "MILD SELLING PRESSURE";
    }
  }

  return {
    aggressiveBuyVolumeUSD,
    aggressiveSellVolumeUSD,
    cvd,
    cvdStatus
  };
}
