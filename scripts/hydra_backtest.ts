import * as fs from 'fs';
import * as readline from 'readline';

interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const INITIAL_CAPITAL = 1000;
const LEVERAGE = 3;
const RISK_PER_TRADE = 0.02; // Risk 2% of equity per trade
const HARD_POSITION_CAP = 500000; // $500k max position
const TAKER_FEE = 0.0004; // 0.04% fee
const SLIPPAGE = 0.0005; // 0.05% slippage

function calculateSMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        sum += candles[i].close;
    }
    return sum / period;
}

function calculateBollingerBands(candles: Candle[], period: number, multiplier: number) {
    if (candles.length < period) return { middle: 0, upper: 0, lower: 0 };
    const middle = calculateSMA(candles, period);
    
    let varianceSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        varianceSum += Math.pow(candles[i].close - middle, 2);
    }
    const standardDeviation = Math.sqrt(varianceSum / period);
    
    return {
        middle,
        upper: middle + (standardDeviation * multiplier),
        lower: middle - (standardDeviation * multiplier)
    };
}

function calculateRSI(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    
    for (let i = candles.length - period; i < candles.length; i++) {
        const change = candles[i].close - candles[i-1].close;
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateTR(candles: Candle[], period: number): number {
    if (candles.length <= period) return 0;
    let trSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    return trSum / period;
}

function calculateADX(candles: Candle[], period: number = 14): number {
    if (candles.length < period * 2) return 0;
    
    let plusDM = 0;
    let minusDM = 0;
    let tr = 0;
    
    for (let i = candles.length - period; i < candles.length; i++) {
        const upMove = candles[i].high - candles[i-1].high;
        const downMove = candles[i-1].low - candles[i].low;
        
        if (upMove > downMove && upMove > 0) plusDM += upMove;
        if (downMove > upMove && downMove > 0) minusDM += downMove;
        
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        tr += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    
    if (tr === 0) return 0;
    
    const plusDI = (plusDM / tr) * 100;
    const minusDI = (minusDM / tr) * 100;
    
    let dxSum = 0;
    // Calculate DX for the previous 'period' days to get ADX
    for (let i = candles.length - period; i < candles.length; i++) {
        const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
        dxSum += isNaN(dx) ? 0 : dx;
    }
    
    return dxSum / period;
}

function calculateATR(candles: Candle[], period: number): number {
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

async function loadCSV(filePath: string): Promise<Candle[]> {
    if (!fs.existsSync(filePath)) return [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const data: Candle[] = [];
    let isHeader = true;

    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        const [timestamp, open, high, low, close, volume] = line.split(',');
        data.push({
            timestamp: parseInt(timestamp),
            open: parseFloat(open),
            high: parseFloat(high),
            low: parseFloat(low),
            close: parseFloat(close),
            volume: parseFloat(volume)
        });
    }
    return data;
}

async function runHydra() {
    console.log("Loading 1H Data for HYDRA (Mean Reversion)...");
    
    const allData = await loadCSV('data/btc_1h_history.csv');
    // Sort just in case
    allData.sort((a, b) => a.timestamp - b.timestamp);
    
    if (allData.length === 0) {
        console.log("No data found.");
        return;
    }

    let balance = INITIAL_CAPITAL;
    let maxBalance = balance;
    let maxDrawdown = 0;
    
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let totalFees = 0;

    let activeTrade: {
        action: 'BUY' | 'SELL';
        entryPrice: number;
        stopLoss: number;
        positionSize: number; // in USD
        quantity: number;
    } | null = null;

    let buffer: Candle[] = [];

    // Yearly Breakdown Tracking
    let yearlyResults: Record<number, { endBalance: number, profitPct: number }> = {};
    let currentYearStr = new Date(allData[0].timestamp).getUTCFullYear();
    let yearlyStartBalance = balance;

    for (let i = 0; i < allData.length; i++) {
        const candle = allData[i];
        buffer.push(candle);
        if (buffer.length > 100) buffer.shift();

        if (buffer.length < 50) continue;

        const currentYear = new Date(candle.timestamp).getUTCFullYear();
        if (currentYear > currentYearStr) {
            yearlyResults[currentYearStr] = {
                endBalance: balance,
                profitPct: ((balance - yearlyStartBalance) / yearlyStartBalance) * 100
            };
            currentYearStr = currentYear;
            yearlyStartBalance = balance;
        }

        const bb = calculateBollingerBands(buffer.slice(0, -1), 20, 2.0);
        const rsi = calculateRSI(buffer.slice(0, -1), 14);
        const atr = calculateATR(buffer.slice(0, -1), 14);
        const adx = calculateADX(buffer.slice(0, -1), 14);

        if (activeTrade) {
            let exitPrice = 0;
            let closed = false;

            if (activeTrade.action === 'BUY') {
                // Exit logic: Hit Middle Band (TP) or Stop Loss
                if (candle.low <= activeTrade.stopLoss) {
                    exitPrice = Math.min(candle.open, activeTrade.stopLoss) * (1 - SLIPPAGE);
                    closed = true;
                } else if (candle.high >= bb.middle) {
                    exitPrice = Math.max(candle.open, bb.middle) * (1 - SLIPPAGE);
                    closed = true;
                }
            } else {
                if (candle.high >= activeTrade.stopLoss) {
                    exitPrice = Math.max(candle.open, activeTrade.stopLoss) * (1 + SLIPPAGE);
                    closed = true;
                } else if (candle.low <= bb.middle) {
                    exitPrice = Math.min(candle.open, bb.middle) * (1 + SLIPPAGE);
                    closed = true;
                }
            }

            if (closed) {
                const rawPnl = activeTrade.action === 'BUY' 
                    ? (exitPrice - activeTrade.entryPrice) * activeTrade.quantity 
                    : (activeTrade.entryPrice - exitPrice) * activeTrade.quantity;
                
                const entryFee = activeTrade.positionSize * TAKER_FEE;
                const exitFee = (activeTrade.quantity * exitPrice) * TAKER_FEE;
                const pnl = rawPnl - entryFee - exitFee;

                balance += pnl;
                totalFees += (entryFee + exitFee);
                
                if (pnl > 0) wins++; else losses++;
                totalTrades++;
                activeTrade = null;

                if (balance > maxBalance) maxBalance = balance;
                const drawdown = (maxBalance - balance) / maxBalance;
                if (drawdown > maxDrawdown) maxDrawdown = drawdown;
            }
        } 
        
        if (!activeTrade) {
            // Mean Reversion Entry Conditions
            // Only trade if the market is RANGING (ADX < 25)
            if (adx < 25) {
                // LONG: Price crosses below Lower BB AND RSI < 30
                if (candle.close < bb.lower && rsi < 30) {
                    const entryPrice = candle.close * (1 + SLIPPAGE);
                    const sl = candle.close - (atr * 2); // 2 ATR Stop Loss
                    
                    const riskDistancePerc = Math.abs(entryPrice - sl) / entryPrice;
                    let positionSize = (balance * RISK_PER_TRADE) / riskDistancePerc;
                    if (positionSize > balance * LEVERAGE) positionSize = balance * LEVERAGE;
                    if (positionSize > HARD_POSITION_CAP) positionSize = HARD_POSITION_CAP;

                    activeTrade = {
                        action: 'BUY',
                        entryPrice,
                        stopLoss: sl,
                        positionSize,
                        quantity: positionSize / entryPrice
                    };
                } 
                // SHORT: Price crosses above Upper BB AND RSI > 70
                else if (candle.close > bb.upper && rsi > 70) {
                    const entryPrice = candle.close * (1 - SLIPPAGE);
                    const sl = candle.close + (atr * 2);
                    
                    const riskDistancePerc = Math.abs(sl - entryPrice) / entryPrice;
                    let positionSize = (balance * RISK_PER_TRADE) / riskDistancePerc;
                    if (positionSize > balance * LEVERAGE) positionSize = balance * LEVERAGE;
                    if (positionSize > HARD_POSITION_CAP) positionSize = HARD_POSITION_CAP;

                    activeTrade = {
                        action: 'SELL',
                        entryPrice,
                        stopLoss: sl,
                        positionSize,
                        quantity: positionSize / entryPrice
                    };
                }
            }
        }
    }
    
    yearlyResults[currentYearStr] = {
        endBalance: balance,
        profitPct: ((balance - yearlyStartBalance) / yearlyStartBalance) * 100
    };

    console.log(`\n=== HYDRA MEAN REVERSION (1H) ===`);
    console.log(`Final Balance: $${balance.toFixed(2)}`);
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100).toFixed(2)}%`);
    console.log(`Max Drawdown: ${(maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Total Fees Paid: $${totalFees.toFixed(2)}`);
    console.log(`\n--- ANNUAL BREAKDOWN ---`);
    for (const year in yearlyResults) {
        console.log(`Year ${year}: $${yearlyResults[year].endBalance.toFixed(2)} (${yearlyResults[year].profitPct.toFixed(2)}%)`);
    }
}

runHydra().catch(console.error);
