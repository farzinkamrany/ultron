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
const GRID_RANGE_PERCENT = 0.05;
const GRID_LEVELS = 40;
const MAKER_FEE = -0.0001;
const TAKER_FEE = 0.0004;
const LEVERAGE = 3;

function calculateADX(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < period * 2) return 0;
    
    let plusDM = 0; let minusDM = 0; let tr = 0;
    
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
    for (let i = candles.length - period; i < candles.length; i++) {
        const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
        dxSum += isNaN(dx) ? 0 : dx;
    }
    
    return dxSum / period;
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
            open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close), volume: parseFloat(volume)
        });
    }
    return data;
}

interface GridLevel { price: number; type: 'BUY' | 'SELL'; active: boolean; }

async function runBehemothBacktest(startTimestamp: number, endTimestamp: number, label: string) {
    const dataFile = 'data/btc_5m_history.csv';
    const btcData = await loadCSV(dataFile, 'BTC');
    
    const globalTimeline = btcData
        .filter(c => c.timestamp >= startTimestamp && c.timestamp <= endTimestamp)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (globalTimeline.length === 0) {
        console.log("No data found for " + label);
        return;
    }

    let balance = INITIAL_CAPITAL;
    let peakBalance = balance;
    
    let stats = { totalTrades: 0, feesEarned: 0, maxDrawdown: 0, recenters: 0, killSwitches: 0 };
    let grid: GridLevel[] = [];
    let upperBound = 0; let lowerBound = 0; let gridStep = 0; let orderSizeUSD = 0; 
    let positionCoins = 0; 
    let totalPositionCost = 0; // FIXED: Track cost for accurate PnL
    let realizedPnl = 0;
    let gridActive = false;

    function buildGrid(currentPrice: number, currentEquity: number) {
        grid = [];
        upperBound = currentPrice * (1 + GRID_RANGE_PERCENT);
        lowerBound = currentPrice * (1 - GRID_RANGE_PERCENT);
        gridStep = (upperBound - lowerBound) / GRID_LEVELS;
        
        orderSizeUSD = (currentEquity * LEVERAGE) / (GRID_LEVELS / 2); 

        for (let i = 0; i <= GRID_LEVELS; i++) {
            const p = lowerBound + (i * gridStep);
            if (p < currentPrice) grid.push({ price: p, type: 'BUY', active: true });
            else grid.push({ price: p, type: 'SELL', active: true });
        }
        gridActive = true;
    }

    function killGrid(currentPrice: number) {
        if (positionCoins !== 0) {
            const exitValue = positionCoins * currentPrice;
            const fee = exitValue * TAKER_FEE;
            
            // Calculate actual realized PnL from the kill switch
            const pnl = exitValue - totalPositionCost;
            realizedPnl += pnl - fee;
            stats.feesEarned -= fee;
            
            positionCoins = 0; 
            totalPositionCost = 0;
        }
        gridActive = false;
        grid = [];
    }

    let buffer: MultiCandle[] = [];
    buildGrid(globalTimeline[0].open, balance);

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        buffer.push(candle);
        if (buffer.length > 100) buffer.shift();

        let adx = 0;
        if (buffer.length >= 24) adx = calculateADX(buffer, 24);

        // FIXED UNREALIZED PNL CALCULATION
        const unrealizedPnl = positionCoins > 0 ? (positionCoins * candle.close) - totalPositionCost : 0;
        const currentEquity = balance + realizedPnl + unrealizedPnl;

        if (adx > 30 && gridActive) {
            killGrid(candle.close);
            stats.killSwitches++;
            continue;
        }

        if (adx < 25 && !gridActive) buildGrid(candle.close, currentEquity);

        if (!gridActive) continue;

        if (candle.close > upperBound || candle.close < lowerBound) {
            killGrid(candle.close);
            stats.recenters++;
            if (adx < 25) buildGrid(candle.close, currentEquity);
            continue;
        }

        for (const level of grid) {
            if (!level.active) continue;

            if (level.type === 'BUY' && candle.low <= level.price) {
                const coinsBought = orderSizeUSD / level.price;
                positionCoins += coinsBought;
                totalPositionCost += orderSizeUSD; // Add to cost basis
                
                const rebate = orderSizeUSD * Math.abs(MAKER_FEE);
                realizedPnl += rebate;
                stats.feesEarned += rebate;
                
                level.active = false;
                const sellLevelIndex = grid.findIndex(g => g.price > level.price);
                if (sellLevelIndex !== -1) grid[sellLevelIndex].active = true;
                
                stats.totalTrades++;
            } 
            else if (level.type === 'SELL' && candle.high >= level.price) {
                if (positionCoins > 0) {
                    const coinsSold = orderSizeUSD / level.price;
                    const avgEntry = totalPositionCost / positionCoins;
                    totalPositionCost -= coinsSold * avgEntry;
                    positionCoins -= coinsSold;
                    
                    const profit = (level.price - avgEntry) * coinsSold;
                    realizedPnl += profit;
                    
                    const rebate = orderSizeUSD * Math.abs(MAKER_FEE);
                    realizedPnl += rebate;
                    stats.feesEarned += rebate;
                    
                    level.active = false;
                    const buyLevelIndex = grid.slice().reverse().findIndex(g => g.price < level.price);
                    if (buyLevelIndex !== -1) grid[grid.length - 1 - buyLevelIndex].active = true;
                    
                    stats.totalTrades++;
                }
            }
        }
        
        // Track max drawdown using correct equity
        if (currentEquity > peakBalance) peakBalance = currentEquity;
        if (peakBalance > 0) {
            const dd = (peakBalance - currentEquity) / peakBalance * 100;
            if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
        }
    }

    const finalUnrealizedPnl = positionCoins > 0 ? (positionCoins * globalTimeline[globalTimeline.length - 1].close) - totalPositionCost : 0;
    const finalEquity = balance + realizedPnl + finalUnrealizedPnl;

    console.log(`--- ${label} ---`);
    console.log(`Final Equity: $${finalEquity.toFixed(2)}`);
    console.log(`Net Profit: $${(finalEquity - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown: ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Kill-Switches: ${stats.killSwitches}`);
    console.log(`\n`);
}

async function run() {
    // 3 Months Ranging (Jan 1 2022 - Mar 31 2022)
    await runBehemothBacktest(1640995200000, 1648771199000, "3 Months Ranging (Q1 2022)");
    // 3 Months Bull (Jan 1 2021 - Mar 31 2021)
    await runBehemothBacktest(1609459200000, 1617235199000, "3 Months Bull (Q1 2021)");
}

run().catch(console.error);
