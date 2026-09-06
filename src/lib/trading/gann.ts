// W.D. Gann Predictive Trading Engine - True Ascension

import { AstroTime, Body, EclipticLongitude } from 'astronomy-engine';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reason: string;
}

/**
 * Calculates Support/Resistance levels based on Gann Square of 9
 */
export function calculateGannSquareOf9(pivotPrice: number, currentPrice: number = pivotPrice): { supports: number[], resistances: number[] } {
  // Gann harmonic angles in a 360-degree cycle:
  // 45° (0.125), 90° (0.25), 120° (0.333), 144° (0.4), 180° (0.5), 270° (0.75), 360° (1.0)
  const increments = [0.125, 0.25, 0.333, 0.4, 0.5, 0.75, 1.0];
  
  const root = Math.sqrt(pivotPrice);
  const targetRoot = Math.sqrt(currentPrice);
  const cycleDiff = Math.abs(targetRoot - root);
  const baseCycles = Math.floor(cycleDiff);
  
  const supports: number[] = [];
  const resistances: number[] = [];
  
  // Project harmonic levels for the current cycle and the next cycle
  for (let cycleOffset = baseCycles - 1; cycleOffset <= baseCycles + 1; cycleOffset++) {
    for (const inc of increments) {
      if (currentPrice >= pivotPrice) {
         const level = Math.pow(root + cycleOffset + inc, 2);
         if (level <= currentPrice) supports.push(level);
         if (level > currentPrice) resistances.push(level);
      } else {
         const level = Math.pow(root - (cycleOffset + inc), 2);
         if (level >= currentPrice) resistances.push(level);
         if (level < currentPrice) supports.push(level);
      }
    }
  }
  
  // Add the base cycle borders (0 degrees / 360 degrees)
  for (let cycleOffset = baseCycles - 1; cycleOffset <= baseCycles + 1; cycleOffset++) {
      if (currentPrice >= pivotPrice) {
          const level = Math.pow(root + cycleOffset, 2);
          if (level <= currentPrice) supports.push(level);
          if (level > currentPrice) resistances.push(level);
      } else {
          const level = Math.pow(root - cycleOffset, 2);
          if (level >= currentPrice) resistances.push(level);
          if (level < currentPrice) supports.push(level);
      }
  }

  supports.sort((a, b) => b - a); // descending
  resistances.sort((a, b) => a - b); // ascending
  
  return { supports, resistances };
}

/**
 * Gann Master Time Cycles (Days)
 */
export const GANN_TIME_CYCLES = [7, 14, 21, 45, 90, 135, 144, 180, 270, 360];

/**
 * Gann Square of 144 (Master Macro Matrix)
 * Divides the price action into 144 harmonic blocks.
 */
export function calculateSquareOf144(absoluteLow: number, trueScaleFactor: number) {
  // A master 144 block cycle. 144 is the square of 12.
  const blockHeight = trueScaleFactor * 144;
  const majorResistances = [
    absoluteLow + (blockHeight * 0.25), // 36 block
    absoluteLow + (blockHeight * 0.50), // 72 block
    absoluteLow + (blockHeight * 0.75), // 108 block
    absoluteLow + blockHeight           // 144 block (The Master Completion)
  ];
  return { majorResistances, blockHeight };
}

export function calculateTimeCycles(daysSincePivot: number): { currentCyclePassed: number, nextCycle: number, daysToNextCycle: number, isReversalWindow: boolean } {
  let currentCyclePassed = 0;
  let nextCycle = GANN_TIME_CYCLES[GANN_TIME_CYCLES.length - 1];

  for (const cycle of GANN_TIME_CYCLES) {
    if (daysSincePivot >= cycle) {
      currentCyclePassed = cycle;
    } else {
      nextCycle = cycle;
      break;
    }
  }

  const daysToNextCycle = nextCycle - daysSincePivot;
  const isReversalWindow = (daysToNextCycle <= 3) || (daysSincePivot - currentCyclePassed <= 3 && currentCyclePassed !== 0);

  return { currentCyclePassed, nextCycle, daysToNextCycle, isReversalWindow };
}

/**
 * Gann Angles (Gann Fans) - True Geometric Scaling
 * Calculates geometric support/resistance lines originating from a pivot.
 */
export function calculateGannAngles(pivotPrice: number, daysSincePivot: number, currentPrice: number, trueScaleFactor: number) {
  const angle1x2 = pivotPrice + (daysSincePivot * trueScaleFactor * 0.5); 
  const angle1x1 = pivotPrice + (daysSincePivot * trueScaleFactor * 1.0); 
  const angle2x1 = pivotPrice + (daysSincePivot * trueScaleFactor * 2.0); 

  let position = "BELOW 1x2 (Extremely Bearish)";
  if (currentPrice > angle2x1) position = "ABOVE 2x1 (Extremely Bullish)";
  else if (currentPrice > angle1x1) position = "BETWEEN 1x1 and 2x1 (Bullish)";
  else if (currentPrice > angle1x2) position = "BETWEEN 1x2 and 1x1 (Weak/Ranging)";

  return { angle1x2, angle1x1, angle2x1, position };
}

/**
 * Downward Gann Angles (Gann Fans)
 * Calculates geometric resistance lines originating from a macro Top.
 */
export function calculateDownwardGannAngles(pivotHighPrice: number, daysSinceHigh: number, currentPrice: number, trueScaleFactor: number) {
  const angle1x2 = pivotHighPrice - (daysSinceHigh * trueScaleFactor * 0.5); 
  const angle1x1 = pivotHighPrice - (daysSinceHigh * trueScaleFactor * 1.0); 
  const angle2x1 = pivotHighPrice - (daysSinceHigh * trueScaleFactor * 2.0); 

  let position = "ABOVE 1x2 (Bearish exhaustion / Potential reversal)";
  if (currentPrice < angle2x1) position = "BELOW 2x1 (Extremely Bearish / Freefall)";
  else if (currentPrice < angle1x1) position = "BETWEEN 1x1 and 2x1 (Bearish)";
  else if (currentPrice < angle1x2) position = "BETWEEN 1x2 and 1x1 (Weak Bearish)";

  return { angle1x2, angle1x1, angle2x1, position };
}

/**
 * Gann Seasonal & Anniversary Cycles
 */
export function calculateAnniversaryCycles(pivotTimestamp: number) {
  const today = new Date();
  const pivot = new Date(pivotTimestamp);
  
  const currentMonth = today.getUTCMonth();
  const currentDay = today.getUTCDate();
  const pivotMonth = pivot.getUTCMonth();
  const pivotDay = pivot.getUTCDate();

  const isAnniversary = (currentMonth === pivotMonth && Math.abs(currentDay - pivotDay) <= 3);

  const solarDates = [
    { m: 2, d: 21, name: "Vernal Equinox" },
    { m: 5, d: 21, name: "Summer Solstice" },
    { m: 8, d: 23, name: "Autumnal Equinox" },
    { m: 11, d: 21, name: "Winter Solstice" }
  ];

  let activeSolarQuarter = null;
  for (const sd of solarDates) {
    if (currentMonth === sd.m && Math.abs(currentDay - sd.d) <= 3) {
      activeSolarQuarter = sd.name;
      break;
    }
  }

  const isSeasonalReversal = isAnniversary || (activeSolarQuarter !== null);

  return { isAnniversary, activeSolarQuarter, isSeasonalReversal };
}

/**
 * Financial Astrology: Cosmic Alignment
 * Checks if the current asset price harmonizes with the ecliptic longitudes of Jupiter or Mars.
 */
export function calculateCosmicAlignment(currentPrice: number) {
  const time = new AstroTime(new Date());
  
  // Get Ecliptic Longitude (0 to 360 degrees)
  const jupiterLon = EclipticLongitude(Body.Jupiter, time);
  const marsLon = EclipticLongitude(Body.Mars, time);

  // Normalize current price to a 360 degree wheel
  // E.g., $65,000 -> 65000 % 360 = 200 degrees
  const priceDegree = currentPrice % 360;

  // Check for Conjunction (0 deg), Opposition (180 deg), or Square (90 deg)
  const checkAlignment = (planetDeg: number, priceDeg: number) => {
    const diff = Math.abs(planetDeg - priceDeg);
    const minDiff = Math.min(diff, 360 - diff); // Shortest path on circle
    
    // Conjunction (Price directly on planet)
    if (minDiff <= 5) return "Conjunction";
    // Opposition (Price exactly opposite planet)
    if (Math.abs(minDiff - 180) <= 5) return "Opposition";
    // Square (Price at 90 deg to planet)
    if (Math.abs(minDiff - 90) <= 5) return "Square";
    
    return null;
  };

  const jupiterAlign = checkAlignment(jupiterLon, priceDegree);
  const marsAlign = checkAlignment(marsLon, priceDegree);

  // Check Inter-Planetary Aspect (Jupiter vs Mars)
  const planetDiff = Math.abs(jupiterLon - marsLon);
  const minPlanetDiff = Math.min(planetDiff, 360 - planetDiff);
  
  let planetaryAspect = null;
  if (minPlanetDiff <= 5) planetaryAspect = "CONJUNCTION (0°)";
  else if (Math.abs(minPlanetDiff - 90) <= 5) planetaryAspect = "SQUARE (90°)";
  else if (Math.abs(minPlanetDiff - 180) <= 5) planetaryAspect = "OPPOSITION (180°)";

  let alignmentString = "No Cosmic Alignment";
  if (planetaryAspect) {
    alignmentString = `⚠️ PLANETARY ASPECT WARNING: Jupiter and Mars are in ${planetaryAspect}. Massive cosmic volatility expected.`;
  } else if (jupiterAlign && marsAlign) {
    alignmentString = `Double Cosmic Alignment: Jupiter (${jupiterAlign}) & Mars (${marsAlign})`;
  } else if (jupiterAlign) {
    alignmentString = `Cosmic Alignment: Jupiter (${jupiterAlign})`;
  } else if (marsAlign) {
    alignmentString = `Cosmic Alignment: Mars (${marsAlign})`;
  }

  // --- ESOTERIC TRANSLATIONS ---
  // 1. Planetary Price Translation (Jupiter Longitude mapped to Price)
  // If Jupiter is at 144 degrees, a harmonic price support is $14400.
  // We find the closest order of magnitude for the current price.
  let orderOfMagnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
  if (orderOfMagnitude < 10) orderOfMagnitude = 10;
  
  // Normalize jupiter longitude to match the asset's magnitude (e.g., 200 degrees -> $20,000 for BTC)
  let jupiterPriceSupport = (jupiterLon / 360) * orderOfMagnitude;
  if (jupiterPriceSupport < currentPrice / 2) jupiterPriceSupport *= 10; // scale up if needed

  // 2. Vernal Equinox Sine Wave (Natural Energy)
  const date = new Date();
  const currentYear = date.getFullYear();
  const vernalEquinox = new Date(`${currentYear}-03-21T00:00:00Z`);
  const daysSinceVernal = Math.floor((date.getTime() - vernalEquinox.getTime()) / (1000 * 60 * 60 * 24));
  // A full cycle is 365.25 days. We convert days to radians.
  const naturalEnergyWave = Math.sin((daysSinceVernal / 365.25) * Math.PI * 2);

  return {
    jupiterDegree: jupiterLon,
    marsDegree: marsLon,
    priceDegree: priceDegree,
    planetaryAspect,
    alignmentString,
    jupiterPriceSupport,
    naturalEnergyWave
  };
}

export function analyzeGannSetup(symbol: string, currentPrice: number, recentCandles: Candle[]): TradeSignal {
  // Legacy function kept for interface compatibility
  return {
    symbol,
    action: "HOLD",
    entryPrice: currentPrice,
    stopLoss: 0,
    takeProfit: 0,
    reason: "Delegated to AI Agent"
  };
}
