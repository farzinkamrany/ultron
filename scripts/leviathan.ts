import * as fs from 'fs';
import * as readline from 'readline';

interface MultiCandle {
    symbol: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const INITIAL_CAPITAL = 1000;
const RISK_PER_TRADE = 0.05; // 5% Risk per trade
const HARD_POSITION_CAP = 500000; // 500k realistic max position size
const MAX_LEVERAGE = 3; // 3x max leverage per trade (15x max total for 5 trades)
const TAKER_FEE = 0.00035; // 0.035% market order fee
const SLIPPAGE = 0.001; // 0.1% slippage for realistic execution

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

// Load and resample directly from stream (Highly Optimized)
async function loadAndResampleTo4H(filePath: string, symbol: string): Promise<MultiCandle[]> {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const data4h: MultiCandle[] = [];
    let currentCandle: MultiCandle | null = null;
    const FOUR_HOURS = 4 * 3600 * 1000;
    let isHeader = true;

    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        const [tsStr, openStr, highStr, lowStr, closeStr, volStr] = line.split(',');
        
        const timestamp = parseInt(tsStr);
        const open = parseFloat(openStr);
        const high = parseFloat(highStr);
        const low = parseFloat(lowStr);
        const close = parseFloat(closeStr);
        const volume = parseFloat(volStr);

        const periodTimestamp = Math.floor(timestamp / FOUR_HOURS) * FOUR_HOURS;

        if (!currentCandle || currentCandle.timestamp !== periodTimestamp) {
            if (currentCandle) data4h.push(currentCandle);
            currentCandle = { symbol, timestamp: periodTimestamp, open, high, low, close, volume };
        } else {
            if (high > currentCandle.high) currentCandle.high = high;
            if (low < currentCandle.low) currentCandle.low = low;
            currentCandle.close = close;
            currentCandle.volume += volume;
        }
    }
    if (currentCandle) data4h.push(currentCandle);
    return data4h;
}

async function runLeviathan() {
    console.log("Loading Assets and Resampling to 4H...");
    const symbols = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'DOGE', 'BNB', 'XRP', 'DOT', 'AVAX'];
    let allData: MultiCandle[] = [];
    
    for (const sym of symbols) {
        try {
            const data = await loadAndResampleTo4H(`data/${sym.toLowerCase()}_15m_history.csv`, sym);
            for (let i = 0; i < data.length; i++) {
                allData.push(data[i]);
            }
        } catch (e) {
            console.log(`Failed to load ${sym}`);
        }
    }

    console.log("Merging Timeline...");
    const START_TIMESTAMP = 1514764800000;
    allData = allData.filter(c => c.timestamp >= START_TIMESTAMP).sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a.symbol.localeCompare(b.symbol);
    });

    let balance = INITIAL_CAPITAL;
    let activeTrades: Record<string, any> = {};
    const buffers: Record<string, MultiCandle[]> = {};
    for (const sym of symbols) buffers[sym] = [];

    let totalTrades = 0, wins = 0, losses = 0;
    let maxBalance = INITIAL_CAPITAL;
    let maxDrawdown = 0;

    let lastYear = new Date(allData[0].timestamp).getUTCFullYear();
    let yearlyStartBalance = INITIAL_CAPITAL;
    const yearlyResults: Record<number, any> = {};
    
    let currentPeakTime = allData[0].timestamp;
    let maxUnderwaterDuration = 0; // in milliseconds

    for (const candle of allData) {
        const { symbol, timestamp, close, high, low, open } = candle;
        buffers[symbol].push(candle);
        if (buffers[symbol].length > 300) buffers[symbol].shift(); // Keep last 300 4H candles

        const candles = buffers[symbol];
        if (candles.length < 200) continue;

        const ema200 = calculateEMA(candles, 200);
        const atr = calculateATR(candles, 14);
        
        // 20-period (approx 3 days) Donchian Channel
        const highest20 = calculateHighestHigh(candles.slice(0, -1), 20);
        const lowest20 = calculateLowestLow(candles.slice(0, -1), 20);

        if (activeTrades[symbol]) {
            const trade = activeTrades[symbol];
            
            // Trailing Stop Logic (Chandelier Exit based on recent highs/lows)
            if (trade.action === 'BUY') {
                const trailStop = calculateLowestLow(candles.slice(0, -1), 10) - atr;
                trade.sl = Math.max(trade.sl, trailStop);
                
                if (low <= trade.sl) {
                    const exitPrice = Math.min(trade.sl, open) * (1 - SLIPPAGE); // Slippage on sell
                    const riskDistancePerc = Math.abs(trade.entryPrice - trade.initialSl) / trade.entryPrice;
                    let positionSize = (balance * RISK_PER_TRADE) / riskDistancePerc;
                    
                    if (positionSize > balance * MAX_LEVERAGE) positionSize = balance * MAX_LEVERAGE;
                    if (positionSize > HARD_POSITION_CAP) positionSize = HARD_POSITION_CAP;
                    
                    const quantity = positionSize / trade.entryPrice;
                    const rawPnl = (exitPrice - trade.entryPrice) * quantity;
                    const fees = (positionSize * TAKER_FEE) + (quantity * exitPrice * TAKER_FEE);
                    const pnl = rawPnl - fees;
                    
                    balance += pnl;
                    
                    if (pnl > 0) wins++; else losses++;
                    totalTrades++;
                    delete activeTrades[symbol];
                }
            } else if (trade.action === 'SELL') {
                const trailStop = calculateHighestHigh(candles.slice(0, -1), 10) + atr;
                trade.sl = Math.min(trade.sl, trailStop);
                
                if (high >= trade.sl) {
                    const exitPrice = Math.max(trade.sl, open) * (1 + SLIPPAGE); // Slippage on buy-to-cover
                    const riskDistancePerc = Math.abs(trade.initialSl - trade.entryPrice) / trade.entryPrice;
                    let positionSize = (balance * RISK_PER_TRADE) / riskDistancePerc;
                    
                    if (positionSize > balance * MAX_LEVERAGE) positionSize = balance * MAX_LEVERAGE;
                    if (positionSize > HARD_POSITION_CAP) positionSize = HARD_POSITION_CAP;
                    
                    const quantity = positionSize / trade.entryPrice;
                    const rawPnl = (trade.entryPrice - exitPrice) * quantity;
                    const fees = (positionSize * TAKER_FEE) + (quantity * exitPrice * TAKER_FEE);
                    const pnl = rawPnl - fees;
                    
                    balance += pnl;
                    
                    if (pnl > 0) wins++; else losses++;
                    totalTrades++;
                    delete activeTrades[symbol];
                }
            }
        } 
        
        if (!activeTrades[symbol] && Object.keys(activeTrades).length < 5) {
            // Trend Breakout Entry
            if (close > ema200 && close > highest20) {
                activeTrades[symbol] = {
                    action: 'BUY',
                    entryPrice: close * (1 + SLIPPAGE), // Slippage on buy
                    initialSl: calculateLowestLow(candles.slice(0, -1), 10) - atr,
                    sl: calculateLowestLow(candles.slice(0, -1), 10) - atr
                };
            } else if (close < ema200 && close < lowest20) {
                activeTrades[symbol] = {
                    action: 'SELL',
                    entryPrice: close * (1 - SLIPPAGE), // Slippage on short
                    initialSl: calculateHighestHigh(candles.slice(0, -1), 10) + atr,
                    sl: calculateHighestHigh(candles.slice(0, -1), 10) + atr
                };
            }
        }

        if (balance > maxBalance) {
            maxBalance = balance;
            maxUnderwaterDuration = Math.max(maxUnderwaterDuration, timestamp - currentPeakTime);
            currentPeakTime = timestamp;
        } else {
            maxUnderwaterDuration = Math.max(maxUnderwaterDuration, timestamp - currentPeakTime);
        }
        
        const drawdown = (maxBalance - balance) / maxBalance;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        
        const currentYear = new Date(timestamp).getUTCFullYear();
        if (currentYear > lastYear) {
            yearlyResults[lastYear] = {
                endBalance: balance,
                profitPct: ((balance - yearlyStartBalance) / yearlyStartBalance) * 100
            };
            
            lastYear = currentYear;
            yearlyStartBalance = balance;
        }
    }
    
    yearlyResults[lastYear] = {
        endBalance: balance,
        profitPct: ((balance - yearlyStartBalance) / yearlyStartBalance) * 100
    };

    console.log(`\n=== LEVIATHAN TREND FOLLOWER (4H COMPOUNDING) ===`);
    console.log(`Final Balance: $${balance.toFixed(2)}`);
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Win Rate: ${((wins / totalTrades) * 100).toFixed(2)}%`);
    console.log(`Max Drawdown: ${(maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Max Underwater Duration: ${(maxUnderwaterDuration / (1000 * 60 * 60 * 24 * 30)).toFixed(1)} months`);
    console.log(`\n--- ANNUAL BREAKDOWN ---`);
    for (const year in yearlyResults) {
        console.log(`Year ${year}: $${yearlyResults[year].endBalance.toFixed(2)} (${yearlyResults[year].profitPct.toFixed(2)}%)`);
    }
}

runLeviathan().catch(console.error);
