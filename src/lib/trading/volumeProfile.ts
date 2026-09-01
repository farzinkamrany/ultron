import { MacroOHLCV } from './chaos';

export interface VolumeBin {
  priceStart: number;
  priceEnd: number;
  volume: number;
}

/**
 * Calculates the Point of Control (POC) using a Volume Profile approach.
 * Distributes the volume of each candle across price bins.
 */
export function calculatePointOfControl(candles: MacroOHLCV[], numBins: number = 100) {
  if (candles.length === 0) return null;

  // 1. Find absolute range
  let absoluteLow = Infinity;
  let absoluteHigh = -Infinity;
  
  for (const candle of candles) {
    if (candle.low < absoluteLow) absoluteLow = candle.low;
    if (candle.high > absoluteHigh) absoluteHigh = candle.high;
  }
  
  if (absoluteHigh === absoluteLow) return absoluteLow; // Edge case
  
  // 2. Create Bins
  const binSize = (absoluteHigh - absoluteLow) / numBins;
  const bins: VolumeBin[] = [];
  
  for (let i = 0; i < numBins; i++) {
    bins.push({
      priceStart: absoluteLow + (i * binSize),
      priceEnd: absoluteLow + ((i + 1) * binSize),
      volume: 0
    });
  }
  
  // 3. Distribute Volume
  for (const candle of candles) {
    // For simplicity, we distribute volume evenly across the bins that the candle's High-Low range touches.
    // In a tick-level system, this would be exact. Here, it's an estimation.
    const startBinIndex = Math.max(0, Math.floor((candle.low - absoluteLow) / binSize));
    const endBinIndex = Math.min(numBins - 1, Math.floor((candle.high - absoluteLow) / binSize));
    
    const binsSpanned = endBinIndex - startBinIndex + 1;
    const volumePerBin = candle.volume / binsSpanned;
    
    for (let i = startBinIndex; i <= endBinIndex; i++) {
      if (bins[i]) {
        bins[i].volume += volumePerBin;
      }
    }
  }
  
  // 4. Find the POC (Bin with Max Volume)
  let pocBin = bins[0];
  let maxVolume = -1;
  
  for (const bin of bins) {
    if (bin.volume > maxVolume) {
      maxVolume = bin.volume;
      pocBin = bin;
    }
  }
  
  // The center of the winning bin is our Point of Control
  const pocPrice = (pocBin.priceStart + pocBin.priceEnd) / 2;
  
  return pocPrice;
}
