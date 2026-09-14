import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateDownwardGannAngles, calculateCosmicAlignment, TradeSignal } from './gann';
import { detectLiquiditySweep, detectRegime, detectCapitulation, detectDominantCycleFFT } from './financial-intelligence';
import { findOrderBlocks } from './ict';

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

export function calculateEMA(candles: any[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += candles[i].close;
    let ema = sum / period;
    for (let i = period; i < candles.length; i++) {
        ema = (candles[i].close - ema) * k + ema;
    }
    return ema;
}

export async function evaluateSetup(
    symbol: string, 
    currentPrice: number, 
    candles: any[], 
    macroCandles: any[], 
    regime: string = 'NORMAL',
    marketContext?: { fundingRate?: number; btcDominanceTrend?: 'UP' | 'DOWN' | 'FLAT' }
): Promise<TradeSignal> {
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
                const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - closestSupport * (1 - dynamicSL)) >= 2.0);
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
                const validTP = supports.find(s => (currentPrice - s) / (closestResistance * (1 + dynamicSL) - currentPrice) >= 2.0);
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
    
    // SMC VALIDATION (Mandatory unless Capitulation)
    if (action !== 'HOLD' && !rationale.includes('Capitulation')) {
        const recentCandles = candles.slice(-300);
        const obs = findOrderBlocks(recentCandles);
        let smcPassed = false;
        
        if (action === 'BUY') {
            const validOB = obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && currentPrice <= ob.top * 1.015 && currentPrice >= ob.bottom * 0.985);
            if (validOB) smcPassed = true;
        } else if (action === 'SELL') {
            const validOB = obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && currentPrice >= ob.bottom * 0.985 && currentPrice <= ob.top * 1.015);
            if (validOB) smcPassed = true;
        }
        
        if (!smcPassed) {
            action = 'HOLD';
            rationale = 'Rejected: No valid Swept Liquidity Order Block nearby (SMC)';
        } else {
            rationale += ' | SMC Swept OB Validated';
        }
    }
    
    // MATHEMATICAL FFT CYCLE FILTER (Prevent buying tops / selling bottoms)
    if (action !== 'HOLD' && candles.length >= 64) {
        const fft = detectDominantCycleFFT(candles, 64);
        if (fft.magnitude > 0) {
            const phaseValue = Math.cos(fft.phase);
            if (action === 'BUY' && phaseValue > 0.7) {
                action = 'HOLD';
                rationale = 'Rejected: FFT Cycle Peak (Buying the Top)';
            } else if (action === 'SELL' && phaseValue < -0.7) {
                action = 'HOLD';
                rationale = 'Rejected: FFT Cycle Trough (Selling the Bottom)';
            } else {
                rationale += ` | FFT Cycle OK (Phase: ${phaseValue.toFixed(2)})`;
            }
        }
    }
    
    // WEEKEND CHOPPINESS FILTER
    if (action !== 'HOLD') {
        const dayOfWeek = new Date().getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            if (!['BTC', 'ETH', 'SOL'].includes(symbol)) {
                action = 'HOLD';
                rationale = 'Rejected: Weekend Choppiness Filter (Altcoin)';
            } else {
                const rr = Math.abs(tp - currentPrice) / Math.abs(currentPrice - sl);
                if (rr < 5) {
                    action = 'HOLD';
                    rationale = `Rejected: Weekend Choppiness Filter (R:R < 5, was ${rr.toFixed(2)})`;
                } else {
                    rationale += ' | Passed Weekend Filter';
                }
            }
        }
    }
    
    // FUNDING RATE FILTER (Contrarian Squeeze Hunter)
    if (action !== 'HOLD' && marketContext?.fundingRate !== undefined) {
        const fr = marketContext.fundingRate;
        if (action === 'BUY' && fr > 0.0003) { // Highly positive funding (everyone is long)
            action = 'HOLD';
            rationale = `Rejected: Funding Rate too high (${(fr*100).toFixed(3)}%). Waiting for long squeeze.`;
        } else if (action === 'SELL' && fr < -0.0003) { // Highly negative funding (everyone is short)
            action = 'HOLD';
            rationale = `Rejected: Funding Rate too low (${(fr*100).toFixed(3)}%). Waiting for short squeeze.`;
        } else if (action === 'BUY' && fr < -0.0001) {
            rationale += ` | High Confidence: Short Squeeze Fuel (${(fr*100).toFixed(3)}%)`;
        } else if (action === 'SELL' && fr > 0.0001) {
            rationale += ` | High Confidence: Long Squeeze Fuel (${(fr*100).toFixed(3)}%)`;
        }
    }
    
    // BTC DOMINANCE CORRELATION SHIELD (Protect Altcoins)
    if (action === 'BUY' && symbol !== 'BTC' && marketContext?.btcDominanceTrend === 'UP') {
        action = 'HOLD';
        rationale = 'Rejected: BTC Dominance is rising. Altcoins are bleeding.';
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
