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
const RISK_PER_TRADE = 0.05; 
const HARD_POSITION_CAP = 50000; 
const MAX_LEVERAGE = 5; 
const TAKER_FEE = 0.00035; 

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
    if (candles.length < period) return Infinity;
    let highest = -Infinity;
    for (let i = candles.length - period; i < candles.length; i++) {
        if (candles[i].high > highest) highest = candles[i].high;
    }
    return highest;
}

function calculateLowestLow(candles: MultiCandle[], period: number): number {
    if (candles.length < period) return -Infinity;
    let lowest = Infinity;
    for (let i = candles.length - period; i < candles.length; i++) {
        if (candles[i].low < lowest) lowest = candles[i].low;
    }
    return lowest;
}

async function loadCSV(filePath: string, symbol: string): Promise<MultiCandle[]> {
    if (!fs.existsSync(filePath)) return [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const data: MultiCandle[] = [];
    let isHeader = true;

    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        const [timestamp, open, high, low, close, volume] = line.split(',');
        data.push({
            symbol,
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

async function loadAndResampleTo4H(filePath: string, symbol: string): Promise<MultiCandle[]> {
    const data15m = await loadCSV(filePath, symbol);
    const data4h: MultiCandle[] = [];
    let currentCandle: MultiCandle | null = null;
    const FOUR_HOURS = 4 * 3600 * 1000;

    for (const c of data15m) {
        const periodTimestamp = Math.floor(c.timestamp / FOUR_HOURS) * FOUR_HOURS;
        if (!currentCandle || currentCandle.timestamp !== periodTimestamp) {
            if (currentCandle) data4h.push(currentCandle);
            currentCandle = { ...c, timestamp: periodTimestamp };
        } else {
            currentCandle.high = Math.max(currentCandle.high, c.high);
            currentCandle.low = Math.min(currentCandle.low, c.low);
            currentCandle.close = c.close;
            currentCandle.volume += c.volume;
        }
    }
    if (currentCandle) data4h.push(currentCandle);
    return data4h;
}

async function runLeviathanYearly() {
    console.log("Loading Assets and Resampling to 4H...");
    const symbols = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'DOGE', 'BNB', 'XRP', 'DOT', 'AVAX'];
    let allData: MultiCandle[] = [];
    
    for (const sym of symbols) {
        try {
            const data = await loadAndResampleTo4H(`data/${sym.toLowerCase()}_15m_history.csv`, sym);
            allData.push(...data);
        } catch (e) {
            console.log(`Failed to load ${sym}`);
        }
    }

    console.log("Merging Timeline...");
    
    for (let targetYear = 2018; targetYear <= 2024; targetYear++) {
        const yearData = allData.filter(c => new Date(c.timestamp).getUTCFullYear() === targetYear).sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return a.symbol.localeCompare(b.symbol);
        });

        if (yearData.length === 0) continue;

        let balance = INITIAL_CAPITAL;
        let activeTrades: Record<string, any> = {};
        const buffers: Record<string, MultiCandle[]> = {};
        for (const sym of symbols) buffers[sym] = [];

        let totalTrades = 0, wins = 0, losses = 0;
        let maxBalance = INITIAL_CAPITAL;
        let maxDrawdown = 0;

        for (const candle of yearData) {
            const { symbol, timestamp, close, high, low, open } = candle;
            buffers[symbol].push(candle);
            if (buffers[symbol].length > 300) buffers[symbol].shift(); // Keep last 300 4H candles

            const candles = buffers[symbol];
            if (candles.length < 200) continue;

            const ema200 = calculateEMA(candles, 200);
            const ema20 = calculateEMA(candles, 20);
            const atr = calculateATR(candles, 14);
            
            const highest20 = calculateHighestHigh(candles.slice(0, -1), 20);
            const lowest20 = calculateLowestLow(candles.slice(0, -1), 20);

            if (activeTrades[symbol]) {
                const trade = activeTrades[symbol];
                
                if (trade.action === 'BUY') {
                    const trailStop = calculateLowestLow(candles.slice(0, -1), 10) - atr;
                    trade.sl = Math.max(trade.sl, trailStop);
                    
                    if (low <= trade.sl) {
                        const exitPrice = Math.min(trade.sl, open);
                        const riskDistancePerc = Math.abs(trade.entryPrice - trade.initialSl) / trade.entryPrice;
                        let positionSize = (balance * RISK_PER_TRADE) / riskDistancePerc;
                        
                        if (positionSize > balance * MAX_LEVERAGE) positionSize = balance * MAX_LEVERAGE;
                        // For this yearly test, we ignore HARD_POSITION_CAP to see true compounding potential from $1000
                        
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
                        const exitPrice = Math.max(trade.sl, open);
                        const riskDistancePerc = Math.abs(trade.initialSl - trade.entryPrice) / trade.entryPrice;
                        let positionSize = (balance * RISK_PER_TRADE) / riskDistancePerc;
                        
                        if (positionSize > balance * MAX_LEVERAGE) positionSize = balance * MAX_LEVERAGE;
                        
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
                if (close > ema200 && close > highest20) {
                    activeTrades[symbol] = { action: 'BUY', entryPrice: close, initialSl: lowest20 - atr, sl: lowest20 - atr };
                } else if (close < ema200 && close < lowest20) {
                    activeTrades[symbol] = { action: 'SELL', entryPrice: close, initialSl: highest20 + atr, sl: highest20 + atr };
                }
            }

            if (balance > maxBalance) maxBalance = balance;
            const drawdown = (maxBalance - balance) / maxBalance;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }
        
        console.log(`[${targetYear}] Start: $1,000 | End: $${balance.toFixed(2)} | Profit: $${(balance - 1000).toFixed(2)} | Win Rate: ${totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0}% | Drawdown: ${(maxDrawdown * 100).toFixed(1)}% | Trades: ${totalTrades}`);
    }
}

runLeviathanYearly().catch(console.error);
