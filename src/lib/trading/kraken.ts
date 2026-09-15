import { TradeSignal } from './gann';
import { calculateATR } from './strategy';

function calculateRSI(candles: any[], period: number = 14): number {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateBollingerBands(candles: any[], period: number = 20, multiplier: number = 2.0) {
    if (candles.length < period) return { upper: 0, middle: 0, lower: 0 };
    
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        sum += candles[i].close;
    }
    const sma = sum / period;

    let varianceSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        varianceSum += Math.pow(candles[i].close - sma, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);

    return {
        upper: sma + (stdDev * multiplier),
        middle: sma,
        lower: sma - (stdDev * multiplier)
    };
}

/**
 * Project Kraken: Forex Dedicated Quant Strategy (Mean-Reversion)
 * Tailored for fiat currency pairs (e.g., EUR/USD, GBP/USD).
 * Features:
 * - RSI + Bollinger Bands Mean Reversion
 * - 1:1.5 Risk to Reward ratio
 * - Strict Weekend Filters (Forex markets are closed)
 */
export async function evaluateForexSetup(
    symbol: string, 
    currentPrice: number, 
    candles: any[], 
    macroCandles: any[], 
    regime: string = 'NORMAL'
): Promise<TradeSignal> {
    
    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let tp = 0;
    let sl = 0;
    let rationale = '';
    let executionType: 'MARKET' | 'LIMIT' = 'MARKET';

    // 1. STRICT WEEKEND FILTER (Forex is closed)
    const dayOfWeek = new Date().getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return { symbol, action: 'HOLD', entryPrice: currentPrice, takeProfit: 0, stopLoss: 0, reason: 'Forex Market Closed (Weekend)' };
    }

    // 2. INDICATORS
    const rsi = calculateRSI(candles, 14);
    const bb = calculateBollingerBands(candles, 20, 2.0);
    const atr = calculateATR(candles, 14);
    
    const prevCandle = candles[candles.length - 1];

    // Forex usually RANGES 70% of the time, so we fade the extremes
    const isOversold = rsi < 35;
    const isOverbought = rsi > 65;
    
    // We enter limit orders at the Bollinger bands if RSI is confirming the extreme
    if (isOversold && currentPrice <= bb.lower * 1.001) {
        action = 'BUY';
        // Risk 1.5 ATR, Reward 2.25 ATR (1:1.5 RR)
        sl = currentPrice - (atr * 1.5);
        tp = currentPrice + (atr * 2.25);
        rationale = `Mean Reversion: BB Lower touch with RSI ${rsi.toFixed(1)}`;
        executionType = 'LIMIT';
    } 
    else if (isOverbought && currentPrice >= bb.upper * 0.999) {
        action = 'SELL';
        sl = currentPrice + (atr * 1.5);
        tp = currentPrice - (atr * 2.25);
        rationale = `Mean Reversion: BB Upper touch with RSI ${rsi.toFixed(1)}`;
        executionType = 'LIMIT';
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
