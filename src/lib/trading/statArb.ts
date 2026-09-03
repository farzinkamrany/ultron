import ccxt from 'ccxt';
import { TRADING_CONFIG } from './config';

export function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(data.length - period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function calculateStdDev(data: number[], mean?: number): number {
  if (data.length === 0) return 0;
  const m = mean ?? calculateSMA(data, data.length);
  const squareDiffs = data.map(val => Math.pow(val - m, 2));
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / data.length;
  return Math.sqrt(avgSquareDiff);
}

export function calculatePearsonCorrelation(arr1: number[], arr2: number[]): number {
  if (arr1.length !== arr2.length || arr1.length === 0) return 0;
  
  const mean1 = calculateSMA(arr1, arr1.length);
  const mean2 = calculateSMA(arr2, arr2.length);
  
  let numerator = 0;
  let denom1 = 0;
  let denom2 = 0;
  
  for (let i = 0; i < arr1.length; i++) {
    const diff1 = arr1[i] - mean1;
    const diff2 = arr2[i] - mean2;
    numerator += (diff1 * diff2);
    denom1 += (diff1 * diff1);
    denom2 += (diff2 * diff2);
  }
  
  if (denom1 === 0 || denom2 === 0) return 0;
  return numerator / Math.sqrt(denom1 * denom2);
}

export function calculateZScoreRatio(prices1: number[], prices2: number[], period: number = 20): { zScore: number, currentRatio: number, meanRatio: number, stdDev: number } {
  if (prices1.length !== prices2.length || prices1.length < period) {
    return { zScore: 0, currentRatio: 0, meanRatio: 0, stdDev: 0 };
  }
  
  // Calculate historical ratios
  const ratios = [];
  for (let i = 0; i < prices1.length; i++) {
    ratios.push(prices1[i] / prices2[i]);
  }
  
  // Use the last 'period' for mean and stdDev
  const recentRatios = ratios.slice(ratios.length - period);
  const currentRatio = recentRatios[recentRatios.length - 1];
  
  const meanRatio = calculateSMA(recentRatios, period);
  const stdDev = calculateStdDev(recentRatios, meanRatio);
  
  const zScore = stdDev === 0 ? 0 : (currentRatio - meanRatio) / stdDev;
  
  return { zScore, currentRatio, meanRatio, stdDev };
}

export interface StatArbSignal {
  action: 'ENTER_ARBITRAGE' | 'EXIT_ARBITRAGE' | 'WAIT';
  leg1: { asset: string; action: 'LONG' | 'SHORT'; };
  leg2: { asset: string; action: 'LONG' | 'SHORT'; };
  zScore: number;
  correlation: number;
}

export function evaluateStatArb(
  asset1: string,
  asset2: string,
  prices1: number[],
  prices2: number[],
  period: number = 20
): StatArbSignal {
  const correlation = calculatePearsonCorrelation(prices1, prices2);
  
  // If assets are not highly correlated, it's too dangerous to arbitrage
  if (correlation < 0.8) {
    return { action: 'WAIT', leg1: { asset: asset1, action: 'LONG' }, leg2: { asset: asset2, action: 'SHORT' }, zScore: 0, correlation };
  }
  
  const { zScore } = calculateZScoreRatio(prices1, prices2, period);
  
  // Z-Score > threshold means Asset1 is overvalued relative to Asset2
  if (zScore >= TRADING_CONFIG.Z_SCORE_THRESHOLD) {
    return {
      action: 'ENTER_ARBITRAGE',
      leg1: { asset: asset1, action: 'SHORT' },
      leg2: { asset: asset2, action: 'LONG' },
      zScore,
      correlation
    };
  }
  
  // Z-Score < -threshold means Asset1 is undervalued relative to Asset2
  if (zScore <= -TRADING_CONFIG.Z_SCORE_THRESHOLD) {
    return {
      action: 'ENTER_ARBITRAGE',
      leg1: { asset: asset1, action: 'LONG' },
      leg2: { asset: asset2, action: 'SHORT' },
      zScore,
      correlation
    };
  }
  
  // Exit condition when Z-Score reverts to 0 (mean)
  if (Math.abs(zScore) <= 0.1) {
    return {
      action: 'EXIT_ARBITRAGE',
      leg1: { asset: asset1, action: 'LONG' },
      leg2: { asset: asset2, action: 'SHORT' }, // Dummy actions for exit
      zScore,
      correlation
    };
  }
  
  return { action: 'WAIT', leg1: { asset: asset1, action: 'LONG' }, leg2: { asset: asset2, action: 'SHORT' }, zScore, correlation };
}

export async function runStatArbAnalysis(asset1: string, asset2: string): Promise<StatArbSignal> {
  const exchange = new ccxt.bybit({ enableRateLimit: true, options: { defaultType: 'spot' } });
  
  try {
    const [ohlcv1, ohlcv2] = await Promise.all([
      exchange.fetchOHLCV(asset1, '1h', undefined, 100),
      exchange.fetchOHLCV(asset2, '1h', undefined, 100)
    ]);
    
    // Extract close prices (index 4)
    const prices1 = ohlcv1.map(candle => candle[4] as number);
    const prices2 = ohlcv2.map(candle => candle[4] as number);
    
    // Evaluate StatArb with period 20 on 1h data
    return evaluateStatArb(asset1, asset2, prices1, prices2, 20);
  } catch (err: any) {
    throw new Error(`StatArb CCXT Error: ${err.message}`);
  }
}
