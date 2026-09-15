export interface CerberusSignal {
    action: 'HEDGE_LONG_BTC' | 'HEDGE_LONG_ETH' | 'CLOSE_ALL' | 'HOLD';
    zScore: number;
    ratio: number;
    reason: string;
}

export function evaluateCerberusSetup(
    btcCandles: any[], 
    ethCandles: any[],
    maPeriod: number = 200,
    zScoreThreshold: number = 2.0
): CerberusSignal {
    
    if (btcCandles.length < maPeriod || ethCandles.length < maPeriod) {
        return { action: 'HOLD', zScore: 0, ratio: 0, reason: 'Not enough data' };
    }

    // 1. Calculate the Ratio (BTC/ETH) for the historical window
    const ratios: number[] = [];
    for (let i = btcCandles.length - maPeriod; i < btcCandles.length; i++) {
        ratios.push(btcCandles[i].close / ethCandles[i].close);
    }

    // 2. Calculate Moving Average of the Ratio
    const sum = ratios.reduce((a, b) => a + b, 0);
    const mean = sum / maPeriod;

    // 3. Calculate Standard Deviation of the Ratio
    const squaredDiffs = ratios.map(r => Math.pow(r - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / maPeriod;
    const stdDev = Math.sqrt(variance);

    // 4. Calculate Current Z-Score
    const currentRatio = ratios[ratios.length - 1];
    const zScore = (currentRatio - mean) / stdDev;

    // 5. Generate Signals
    let action: CerberusSignal['action'] = 'HOLD';
    let reason = `Z-Score: ${zScore.toFixed(2)}`;

    // If Z-Score > 2.0: BTC is overvalued, ETH is undervalued. 
    // We expect the ratio to drop back to mean. So we Short BTC and Long ETH.
    if (zScore >= zScoreThreshold) {
        action = 'HEDGE_LONG_ETH'; // Short BTC, Long ETH
        reason = `BTC Overvalued. Short BTC / Long ETH. Z: ${zScore.toFixed(2)}`;
    }
    // If Z-Score < -2.0: BTC is undervalued, ETH is overvalued.
    // We expect the ratio to rise back to mean. So we Long BTC and Short ETH.
    else if (zScore <= -zScoreThreshold) {
        action = 'HEDGE_LONG_BTC'; // Long BTC, Short ETH
        reason = `ETH Overvalued. Long BTC / Short ETH. Z: ${zScore.toFixed(2)}`;
    }
    // If Z-Score crosses zero (Mean Reversion), close all positions
    else if (Math.abs(zScore) < 0.1) {
        action = 'CLOSE_ALL';
        reason = `Mean Reversion Reached. Closing Hedge.`;
    }

    return {
        action,
        zScore,
        ratio: currentRatio,
        reason
    };
}
