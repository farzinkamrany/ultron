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
const GRID_RANGE_PERCENT = 0.15; // 15% up and down from starting price
const GRID_LEVELS = 50; // 50 levels total
const MAKER_FEE = -0.0001; // -0.01% Rebate
const LEVERAGE = 3; // 3x leverage

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

async function runBehemothYearly() {
    console.log("Loading 15-Minute Data for BEHEMOTH (Static Grid Yearly Test)...");
    const btcData = await loadCSV('data/btc_15m_history.csv', 'BTC');

    for (let targetYear = 2018; targetYear <= 2024; targetYear++) {
        const yearData = btcData.filter(c => new Date(c.timestamp).getUTCFullYear() === targetYear)
                                .sort((a, b) => a.timestamp - b.timestamp);

        if (yearData.length === 0) continue;

        let balance = INITIAL_CAPITAL;
        let peakBalance = balance;
        let stats = { totalTrades: 0, feesEarned: 0, maxDrawdown: 0 };

        const startPrice = yearData[0].open;
        const upperBound = startPrice * (1 + GRID_RANGE_PERCENT);
        const lowerBound = startPrice * (1 - GRID_RANGE_PERCENT);
        const gridStep = (upperBound - lowerBound) / GRID_LEVELS;
        
        const orderSizeUSD = (balance * LEVERAGE) / (GRID_LEVELS / 2); 

        interface GridLevel { price: number; type: 'BUY' | 'SELL'; active: boolean; }
        let grid: GridLevel[] = [];
        
        for (let i = 0; i <= GRID_LEVELS; i++) {
            const p = lowerBound + (i * gridStep);
            if (p < startPrice) grid.push({ price: p, type: 'BUY', active: true });
            else grid.push({ price: p, type: 'SELL', active: true });
        }

        let positionCoins = 0; 
        let realizedPnl = 0;

        for (const candle of yearData) {
            for (const level of grid) {
                if (!level.active) continue;

                if (level.type === 'BUY' && candle.low <= level.price) {
                    const coinsBought = orderSizeUSD / level.price;
                    positionCoins += coinsBought;
                    
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
                        positionCoins -= coinsSold;
                        
                        const profit = (gridStep / level.price) * orderSizeUSD;
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
            
            const unrealizedPnl = positionCoins * candle.close - (positionCoins * startPrice);
            const currentEquity = balance + realizedPnl + unrealizedPnl;
            
            if (currentEquity > peakBalance) peakBalance = currentEquity;
            const dd = (peakBalance - currentEquity) / peakBalance * 100;
            if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
        }

        const finalEquity = balance + realizedPnl + (positionCoins * yearData[yearData.length - 1].close);
        
        console.log(`[${targetYear}] Trades: ${stats.totalTrades.toString().padEnd(4)} | Start: $1,000 | End: $${finalEquity.toFixed(2).padStart(8)} | Profit: $${(finalEquity - 1000).toFixed(2).padStart(8)} | Max Drawdown: ${stats.maxDrawdown.toFixed(1)}%`);
    }
}

runBehemothYearly().catch(console.error);
