import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateDownwardGannAngles, calculateCosmicAlignment, TradeSignal } from './gann';
import { detectCapitulation } from './financial-intelligence';

export function calculateATR(candles: any[], period: number = 14): number {
    if (candles.length < 2) return 0;
    const actualPeriod = Math.min(period, candles.length - 1);
    let trSum = 0;
    for (let i = candles.length - actualPeriod; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    return trSum / actualPeriod;
}

export async function evaluateSetup(symbol: string, currentPrice: number, candles: any[], macroCandles: any[], regime: string = 'NORMAL'): Promise<TradeSignal> {
    const gann = calculateGannSquareOf9(currentPrice);
    const supports = gann.supports.sort((a, b) => b - a);
    const resistances = gann.resistances.sort((a, b) => a - b);
    
    if (supports.length === 0 || resistances.length === 0) {
        return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'No Gann levels found.' };
    }
    
    const closestSupport = supports[0];
    const closestResistance = resistances[0];
    const distanceToSupportPerc = (currentPrice - closestSupport) / currentPrice;
    const distanceToResPerc = (closestResistance - currentPrice) / currentPrice;
    
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let tp = 0;
    let sl = 0;
    let rationale = '';
    let executionType: 'MARKET' | 'LIMIT' = 'MARKET';
    
    const atr = calculateATR(candles);
    let dynamicSL = (atr / currentPrice) * 1.5; 
    if (dynamicSL < 0.003) dynamicSL = 0.003; 
    
    const capitulation = await detectCapitulation(candles, symbol, 200);
    if (capitulation === 'BULLISH') {
        action = 'BUY'; 
        sl = currentPrice * (1 - dynamicSL); 
        tp = currentPrice * (1 + (dynamicSL * 5)); 
        rationale = 'Volume Capitulation (BULLISH)';
        executionType = 'MARKET';
    } 
    else if (capitulation === 'BEARISH') {
        action = 'SELL';
        sl = currentPrice * (1 + dynamicSL);
        tp = currentPrice * (1 - (dynamicSL * 5));
        rationale = 'Volume Capitulation (BEARISH)';
        executionType = 'MARKET';
    }
    
    if (action === 'HOLD') {
        if (regime === 'RANGING') {
            if (distanceToSupportPerc <= dynamicSL) {
                const validTP = resistances.find(r => r > currentPrice);
                if (validTP && (validTP - currentPrice) / (currentPrice - closestSupport * (1 - dynamicSL)) >= 1.0) {
                    action = 'BUY'; 
                    tp = validTP; 
                    sl = closestSupport * (1 - dynamicSL); 
                    const rr = (validTP - currentPrice) / (currentPrice - sl);
                    rationale = `Mean Reversion Support Bounce (R:R ${rr.toFixed(2)})`;
                    executionType = 'LIMIT';
                }
            } else if (distanceToResPerc <= dynamicSL) {
                const validTP = supports.find(s => s < currentPrice);
                if (validTP && (currentPrice - validTP) / (closestResistance * (1 + dynamicSL) - currentPrice) >= 1.0) {
                    action = 'SELL'; 
                    tp = validTP; 
                    sl = closestResistance * (1 + dynamicSL); 
                    const rr = (currentPrice - validTP) / (sl - currentPrice);
                    rationale = `Mean Reversion Res Rejection (R:R ${rr.toFixed(2)})`;
                    executionType = 'LIMIT';
                }
            }
        } else {
            if (distanceToSupportPerc <= dynamicSL) {
                const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - closestSupport * (1 - dynamicSL)) >= 1.5);
                if (validTP) { 
                    action = 'BUY'; 
                    tp = validTP; 
                    sl = closestSupport * (1 - dynamicSL); 
                    const rr = (validTP - currentPrice) / (currentPrice - sl);
                    rationale = `Gann Support Bounce (R:R ${rr.toFixed(2)})`;
                    executionType = 'LIMIT';
                }
            } 
            else if (distanceToResPerc <= dynamicSL) {
                const validTP = supports.find(s => (currentPrice - s) / (closestResistance * (1 + dynamicSL) - currentPrice) >= 1.5);
                if (validTP) { 
                    action = 'SELL'; 
                    tp = validTP; 
                    sl = closestResistance * (1 + dynamicSL); 
                    const rr = (currentPrice - validTP) / (sl - currentPrice);
                    rationale = `Gann Resistance Rejection (R:R ${rr.toFixed(2)})`;
                    executionType = 'LIMIT';
                }
            }
        }
    }
    
    if (action !== 'HOLD') {
        return {
            symbol,
            action,
            entryPrice: currentPrice,
            takeProfit: tp,
            stopLoss: sl,
            reason: rationale,
            executionType
        };
    }
    
    return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'No confluence.' };
}
