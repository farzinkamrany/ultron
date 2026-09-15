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
const MAKER_FEE = -0.0001; // -0.01% (Rebate for providing liquidity, Binance Post-Only)
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

async function runBehemothBacktest() {
    console.log("Loading 5-Minute Data for BEHEMOTH Grid Trader...");
    
    const btcData = await loadCSV('data/btc_5m_history.csv', 'BTC');
    
    // We test 2022 (Bear market / Ranging)
    const START_TIMESTAMP = 1640995200000; // Jan 1, 2022
    const END_TIMESTAMP = 1672531199000; // Dec 31, 2022
    
    const globalTimeline = btcData
        .filter(c => c.timestamp >= START_TIMESTAMP && c.timestamp <= END_TIMESTAMP)
        .sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Loaded ${globalTimeline.length} candles (5m). Starting Grid simulation...\n`);

    if (globalTimeline.length === 0) {
        console.log("No data found for 2022. Exiting.");
        return;
    }

    let balance = INITIAL_CAPITAL;
    let peakBalance = balance;
    
    let stats = {
        totalTrades: 0,
        feesEarned: 0,
        maxDrawdown: 0
    };

    // Initialize Grid
    const startPrice = globalTimeline[0].open;
    const upperBound = startPrice * (1 + GRID_RANGE_PERCENT);
    const lowerBound = startPrice * (1 - GRID_RANGE_PERCENT);
    const gridStep = (upperBound - lowerBound) / GRID_LEVELS;
    
    const orderSizeUSD = (balance * LEVERAGE) / (GRID_LEVELS / 2); // Allocate leverage across half the grid

    interface GridLevel {
        price: number;
        type: 'BUY' | 'SELL';
        active: boolean; // Is the limit order active on the book?
    }

    let grid: GridLevel[] = [];
    
    // Create grid levels
    for (let i = 0; i <= GRID_LEVELS; i++) {
        const p = lowerBound + (i * gridStep);
        if (p < startPrice) {
            grid.push({ price: p, type: 'BUY', active: true });
        } else {
            grid.push({ price: p, type: 'SELL', active: true });
        }
    }

    let positionCoins = 0; // Current held asset
    let realizedPnl = 0;

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        
        // Check which grid levels were hit during this 5-minute candle wick
        for (const level of grid) {
            if (!level.active) continue;

            if (level.type === 'BUY' && candle.low <= level.price) {
                // Buy Limit Hit
                const coinsBought = orderSizeUSD / level.price;
                positionCoins += coinsBought;
                
                // Earn Rebate
                const rebate = orderSizeUSD * Math.abs(MAKER_FEE);
                realizedPnl += rebate;
                stats.feesEarned += rebate;
                
                // Deactivate this buy level, activate the sell level above it
                level.active = false;
                const sellLevelIndex = grid.findIndex(g => g.price > level.price);
                if (sellLevelIndex !== -1) grid[sellLevelIndex].active = true;
                
                stats.totalTrades++;
            } 
            else if (level.type === 'SELL' && candle.high >= level.price) {
                // Sell Limit Hit
                if (positionCoins > 0) {
                    const coinsSold = orderSizeUSD / level.price;
                    positionCoins -= coinsSold;
                    
                    // The difference between the grid step is pure profit
                    const profit = (gridStep / level.price) * orderSizeUSD;
                    realizedPnl += profit;
                    
                    // Earn Rebate
                    const rebate = orderSizeUSD * Math.abs(MAKER_FEE);
                    realizedPnl += rebate;
                    stats.feesEarned += rebate;
                    
                    // Deactivate this sell level, activate the buy level below it
                    level.active = false;
                    const buyLevelIndex = grid.slice().reverse().findIndex(g => g.price < level.price);
                    if (buyLevelIndex !== -1) grid[grid.length - 1 - buyLevelIndex].active = true;
                    
                    stats.totalTrades++;
                }
            }
        }
        
        // Track equity (Realized PnL + Unrealized PnL of held coins)
        const unrealizedPnl = positionCoins * candle.close - (positionCoins * startPrice); // simplified
        const currentEquity = balance + realizedPnl + unrealizedPnl;
        
        if (currentEquity > peakBalance) peakBalance = currentEquity;
        const dd = (peakBalance - currentEquity) / peakBalance * 100;
        if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
        
        // Dynamic re-centering of grid if price escapes
        if (candle.close > upperBound * 1.05 || candle.close < lowerBound * 0.95) {
            // Price escaped the grid too far, re-center the grid (take a small loss/gain and restart)
            // For simplicity in this backtest, we just stop trading if it escapes entirely
        }
    }

    const finalEquity = balance + realizedPnl + (positionCoins * globalTimeline[globalTimeline.length - 1].close);

    console.log(`============================================`);
    console.log(`   BEHEMOTH GRID TRADER (5M) BACKTEST`);
    console.log(`   Data: BTC (Year 2022 - Bear Market)`);
    console.log(`============================================`);
    console.log(`Final Equity:     $${finalEquity.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(finalEquity - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`Total Rebates:    $${stats.feesEarned.toFixed(2)}`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`============================================\n`);
}

runBehemothBacktest().catch(console.error);
