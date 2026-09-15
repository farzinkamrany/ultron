export interface DoomsdaySignal {
    action: 'BUY' | 'HOLD';
    reason: string;
    tp: number;
    sl: number;
}

/**
 * Doomsday Protocol: Liquidation Hunter
 * Waits for a massive, sudden market crash (panic) and buys the bottom wick.
 */
export function evaluateDoomsdaySetup(candles: any[], dropThresholdPercent: number = 5.0): DoomsdaySignal {
    if (candles.length < 5) return { action: 'HOLD', reason: 'Not enough data', tp: 0, sl: 0 };
    
    // We look at the last 4 candles to find the highest point before a potential crash
    const recentCandles = candles.slice(-4);
    const currentCandle = recentCandles[3];
    
    // Find the highest high in the last 4 candles (before the crash)
    let highestHigh = 0;
    for (const c of recentCandles) {
        if (c.high > highestHigh) highestHigh = c.high;
    }
    
    // Calculate the drop percentage from the highest point to the current low
    const dropPercent = ((highestHigh - currentCandle.low) / highestHigh) * 100;
    
    // Condition 1: Massive sudden drop (Flash Crash)
    if (dropPercent >= dropThresholdPercent) {
        // Condition 2: Is it a wick? (Price bounced significantly from the absolute low)
        // If close is much higher than the low, it means liquidations finished and smart money is buying.
        const wickSize = currentCandle.close - currentCandle.low;
        const totalSize = currentCandle.high - currentCandle.low;
        
        // If the wick makes up at least 30% of the entire candle body, it's a strong rejection
        if (wickSize > totalSize * 0.3) {
            
            // Risk Management for Doomsday:
            // The stop loss must be just below the absolute low of the crash wick.
            const sl = currentCandle.low * 0.995; // 0.5% below the crash low
            
            // The take profit is exactly at the pre-crash high (Mean Reversion)
            const tp = highestHigh * 0.99; 
            
            return {
                action: 'BUY',
                reason: `DOOMSDAY TRIGGERED: ${dropPercent.toFixed(2)}% Crash Detected. Liquidations scooped.`,
                tp,
                sl
            };
        }
    }
    
    return { action: 'HOLD', reason: 'Market is stable', tp: 0, sl: 0 };
}
