import ccxt, { Exchange } from 'ccxt';
import { supabase } from '../supabase';

interface MultiCandle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

function calculateEMA(candles: MultiCandle[], period: number): number {
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

function calculateATR(candles: MultiCandle[], period: number = 14): number {
    if (candles.length <= period) return 0;
    let trSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trSum += tr;
    }
    return trSum / period;
}

function calculateHighestHigh(candles: MultiCandle[], period: number): number {
    let highest = -Infinity;
    const start = Math.max(0, candles.length - period);
    for (let i = start; i < candles.length; i++) {
        if (candles[i].high > highest) highest = candles[i].high;
    }
    return highest;
}

function calculateLowestLow(candles: MultiCandle[], period: number): number {
    let lowest = Infinity;
    const start = Math.max(0, candles.length - period);
    for (let i = start; i < candles.length; i++) {
        if (candles[i].low < lowest) lowest = candles[i].low;
    }
    return lowest;
}

export type LeviathanAction = 
    | { type: 'ENTER_LONG', entryPrice: number, stopLoss: number, context: string }
    | { type: 'ENTER_SHORT', entryPrice: number, stopLoss: number, context: string }
    | { type: 'UPDATE_SL', newStopLoss: number, tradeId: number, oldStopLoss: number }
    | { type: 'NONE' };

export async function processLeviathanSymbol(exchange: Exchange, symbol: string): Promise<LeviathanAction> {
    try {
        // Fetch last 300 4H candles to ensure EMA200 is accurate
        const ohlcv = await exchange.fetchOHLCV(symbol, '4h', undefined, 300);
        if (!ohlcv || ohlcv.length < 200) return { type: 'NONE' };

        const candles: MultiCandle[] = ohlcv.map(c => ({
            timestamp: c[0] as number,
            open: c[1] as number,
            high: c[2] as number,
            low: c[3] as number,
            close: c[4] as number,
            volume: c[5] as number
        }));

        const latestCandle = candles[candles.length - 1];
        const currentPrice = latestCandle.close;

        // Calculate Indicators
        const ema200 = calculateEMA(candles, 200);
        const atr = calculateATR(candles, 14);
        
        // 20-period (approx 3 days) Donchian Channel
        const highest20 = calculateHighestHigh(candles.slice(0, -1), 20);
        const lowest20 = calculateLowestLow(candles.slice(0, -1), 20);

        // Check if we have an open trade for this symbol
        const { data: openTrades } = await supabase
            .from('paper_trades')
            .select('*')
            .eq('symbol', symbol)
            .eq('status', 'OPEN');

        const openTrade = openTrades && openTrades.length > 0 ? openTrades[0] : null;

        if (openTrade) {
            // TRAILING STOP LOGIC (Chandelier Exit)
            if (openTrade.position_type === 'LONG') {
                const trailStop = calculateLowestLow(candles.slice(0, -1), 10) - atr;
                const currentSL = openTrade.stop_loss || 0;
                
                // Only trail UP
                if (trailStop > currentSL) {
                    return { type: 'UPDATE_SL', newStopLoss: trailStop, tradeId: openTrade.id, oldStopLoss: currentSL };
                }
            } else if (openTrade.position_type === 'SHORT') {
                const trailStop = calculateHighestHigh(candles.slice(0, -1), 10) + atr;
                const currentSL = openTrade.stop_loss || Infinity;
                
                // Only trail DOWN
                if (trailStop < currentSL) {
                    return { type: 'UPDATE_SL', newStopLoss: trailStop, tradeId: openTrade.id, oldStopLoss: currentSL };
                }
            }
            return { type: 'NONE' };
        } else {
            // ENTRY LOGIC
            
            // Check global open trades count to respect MAX 5 trades rule (Optional, but safe)
            const { count } = await supabase
                .from('paper_trades')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'OPEN');
                
            if (count !== null && count >= 5) return { type: 'NONE' };

            if (currentPrice > ema200 && currentPrice > highest20) {
                const sl = calculateLowestLow(candles.slice(0, -1), 10) - atr;
                return {
                    type: 'ENTER_LONG',
                    entryPrice: currentPrice,
                    stopLoss: sl,
                    context: `Leviathan 4H Trend Breakout LONG | EMA200=${ema200.toFixed(4)}`
                };
            } else if (currentPrice < ema200 && currentPrice < lowest20) {
                const sl = calculateHighestHigh(candles.slice(0, -1), 10) + atr;
                return {
                    type: 'ENTER_SHORT',
                    entryPrice: currentPrice,
                    stopLoss: sl,
                    context: `Leviathan 4H Trend Breakout SHORT | EMA200=${ema200.toFixed(4)}`
                };
            }
        }

    } catch (err) {
        console.error(`[Leviathan] Error processing ${symbol}:`, err);
    }

    return { type: 'NONE' };
}
