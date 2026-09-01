import ccxt from 'ccxt';
import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateDownwardGannAngles, calculateAnniversaryCycles, calculateCosmicAlignment, calculateSquareOf144 } from './gann';

export async function analyzeMarketData(asset: string, timeHorizonDays: number): Promise<string> {
  try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const exchange = new ccxt.binance({ enableRateLimit: true });
    
    if (proxyUrl) {
      exchange.httpsProxy = proxyUrl;
    }

    // Determine timeframe based on time horizon
    let timeframe = '1d';
    let label = 'Daily';
    
    if (timeHorizonDays <= 7) {
      timeframe = '4h';
      label = '4-Hour';
    } else if (timeHorizonDays <= 60) {
      timeframe = '1d';
      label = 'Daily';
    } else {
      timeframe = '1w';
      label = 'Weekly';
    }

    // Fetch the last 15 candles for the selected timeframe
    const ohlcv = await exchange.fetchOHLCV(asset, timeframe, undefined, 15);
    const closes = ohlcv.map(candle => candle[4]);
    const currentPrice = closes[closes.length - 1] as number;
    
    const trendStr = closes.map(c => `$${c}`).join(" -> ");
    
    // Calculate full spectrum of Gann levels
    const { supports, resistances } = calculateGannSquareOf9(currentPrice);
    
    // Calculate Volume Climax (30-day average vs current)
    const recentVols = ohlcv.map(candle => candle[5] as number);
    const currentVol = recentVols[recentVols.length - 1];
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const isVolumeClimax = currentVol > (avgVol * 2.0); // 200% spike

    // Fetch Macro Pivot (Last 365 Days) to calculate Time Squaring & True Scale
    let timeAnalysisStr = "Time Cycle Data Unavailable";
    try {
      const macroOhlcv = await exchange.fetchOHLCV(asset, '1d', undefined, 365);
      let absoluteLow = Infinity;
      let absoluteHigh = -Infinity;
      let pivotTimestamp = 0;
      let highTimestamp = 0;
      
      for (const candle of macroOhlcv) {
        const low = candle[3] as number;
        const high = candle[2] as number;
        const ts = candle[0] as number;
        if (low !== undefined && ts !== undefined && low < absoluteLow) {
          absoluteLow = low; // Low price
          pivotTimestamp = ts; // Timestamp
        }
        if (high !== undefined && ts !== undefined && high > absoluteHigh) {
          absoluteHigh = high; // High price
          highTimestamp = ts;
        }
      }
      
      const trueScaleFactor = (absoluteHigh - absoluteLow) / 365;
      const daysSincePivot = Math.floor((Date.now() - pivotTimestamp) / (1000 * 60 * 60 * 24));
      const daysSinceHigh = Math.floor((Date.now() - highTimestamp) / (1000 * 60 * 60 * 24));
      
      const { currentCyclePassed, nextCycle, daysToNextCycle, isReversalWindow } = calculateTimeCycles(daysSincePivot);
      
      // The Death Zone (Upward vs Downward)
      const upwardAngles = calculateGannAngles(absoluteLow, daysSincePivot, currentPrice, trueScaleFactor);
      const downwardAngles = calculateDownwardGannAngles(absoluteHigh, daysSinceHigh, currentPrice, trueScaleFactor);
      
      const isApexZone = Math.abs(upwardAngles.angle1x1 - downwardAngles.angle1x1) / currentPrice < 0.05; // Lines crossing within 5%

      const seasons = calculateAnniversaryCycles(pivotTimestamp);
      const cosmos = calculateCosmicAlignment(currentPrice);
      const macro144 = calculateSquareOf144(absoluteLow, trueScaleFactor);
      
      timeAnalysisStr = `Days Since Macro Bottom: ${daysSincePivot}
Days Since Macro Top: ${daysSinceHigh}
IS REVERSAL WINDOW (Time Squaring): ${isReversalWindow ? "YES" : "NO"}
VOLUME CLIMAX DETECTED: ${isVolumeClimax ? "YES (Whale Activity)" : "NO"}

[GANN APEX GEOMETRY (TRUE SCALE: $${trueScaleFactor.toFixed(2)}/day)]
Upward 1x1: $${upwardAngles.angle1x1.toFixed(2)} | Pos: ${upwardAngles.position}
Downward 1x1: $${downwardAngles.angle1x1.toFixed(2)} | Pos: ${downwardAngles.position}
IS DEATH ZONE APEX (Angles Crossing): ${isApexZone ? "YES - CRITICAL SQUEEZE" : "NO"}

[MACRO MATRIX: SQUARE OF 144]
144-Block Macro Resistances: ${macro144.majorResistances.map(r => `$${r.toFixed(0)}`).join(" | ")}

[SEASONAL & ANNIVERSARY CYCLES]
Is Anniversary of Macro Bottom: ${seasons.isAnniversary ? "YES" : "NO"}
Active Solar Quarter: ${seasons.activeSolarQuarter || "None"}

[ESOTERIC FINANCIAL ASTROLOGY]
Price Degree (360 Wheel): ${cosmos.priceDegree.toFixed(2)}°
Jupiter Longitude: ${cosmos.jupiterDegree.toFixed(2)}°
Mars Longitude: ${cosmos.marsDegree.toFixed(2)}°
ALIGNMENT STATUS: ${cosmos.alignmentString}
Planetary Price Translation (Jupiter Level): $${cosmos.jupiterPriceSupport.toFixed(2)}
Vernal Sine Wave (Natural Energy): ${cosmos.naturalEnergyWave > 0 ? "EXPANDING (+)" : "CONTRACTING (-)"} (${cosmos.naturalEnergyWave.toFixed(2)})`;
    } catch (err) {
      console.warn("Failed to fetch macro history", err);
    }

    return `
[DYNAMIC MARKET ANALYSIS FOR ${timeHorizonDays} DAYS]
Asset: ${asset}
Current Price: $${currentPrice.toFixed(2)}
Selected Timeframe: ${label} (${timeframe})
Trend (Last 15 ${label} closes):
${trendStr}

W.D. Gann Support Levels (Closest to Farthest):
${supports.map((s, i) => `S${i+1}: $${s.toFixed(2)}`).join(" | ")}

W.D. Gann Resistance Levels (Closest to Farthest):
${resistances.map((r, i) => `R${i+1}: $${r.toFixed(2)}`).join(" | ")}

[MASTER TIME CYCLES (TIME SQUARING)]
${timeAnalysisStr}

AI DIRECTIVE:
1. Review the Trend above to determine if the market is Bullish or Bearish on this timeframe.
2. Select an appropriate Target (Take Profit) from the Gann Resistances. For short horizons (e.g. 4 days), use R1 or R2. For long horizons (e.g. 180 days), use R5, R6, or R8.
3. Select an appropriate Stop Loss from the Gann Supports.
4. INCORPORATE TIME & GEOMETRY: If "IS REVERSAL WINDOW" or "IS SEASONAL REVERSAL" is YES, and price is near Gann Support/Resistance, this is a mathematical "Squaring of Time and Price". Highlight this as extremely high probability. Use the Geometric Position (Gann Fan) to confirm the strength of the trend.
5. Output your final decision (STRONG BUY / STRONG SHORT / NO TRADE) and exact prices based on this data. If a GANN MASTER SIGNAL is triggered (Time + Price + Geometry align), output "GANN MASTER SIGNAL" instead.
`;
  } catch (error: any) {
    return `Failed to analyze market for ${asset}: ${error.message}`;
  }
}
