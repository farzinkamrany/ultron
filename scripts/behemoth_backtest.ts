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
const GRID_RANGE_PERCENT = 0.05; // Tighter grid: 5% up and down
const GRID_LEVELS = 40; // 40 levels
const MAKER_FEE = -0.0001; // -0.01% Rebate
const TAKER_FEE = 0.0004; // 0.04% Market exit fee
const LEVERAGE = 3;

function calculateADX(candles: MultiCandle[], period: number = 14): number {
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
            open: parseFloat(open),
            high: parseFloat(high),
            low: parseFloat(low),
            close: parseFloat(close),
            volume: parseFloat(volume)
        });
    }
    return data;
}

interface GridLevel {
    price: number;
    type: 'BUY' | 'SELL';
    active: boolean;
}

async function runBehemothBacktest() {
    const dataFile = process.argv[2] || 'data/btc_5m_history.csv';
    console.log(`Loading Data from ${dataFile} for BEHEMOTH (Smart Grid)...`);
    
    const btcData = await loadCSV(dataFile, 'BTC');
    
    // We test 2022 (Bear market / Ranging)
    const START_TIMESTAMP = 1640995200000; // Jan 1, 2022
    const END_TIMESTAMP = 1672531199000; // Dec 31, 2022
    
    const globalTimeline = btcData
        .filter(c => c.timestamp >= START_TIMESTAMP && c.timestamp <= END_TIMESTAMP)
        .sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Loaded ${globalTimeline.length} candles (5m). Starting Smart Grid simulation...\n`);

    if (globalTimeline.length === 0) {
        console.log("No data found for 2022. Exiting.");
        return;
    }

    let balance = INITIAL_CAPITAL;
    let peakBalance = balance;
    
    let stats = {
        totalTrades: 0,
        feesEarned: 0,
        maxDrawdown: 0,
        recenters: 0,
        killSwitches: 0
    };

    let grid: GridLevel[] = [];
    let upperBound = 0;
    let lowerBound = 0;
    let gridStep = 0;
    let orderSizeUSD = 0;
    let positionCoins = 0;
    let realizedPnl = 0;
    let gridActive = false;

    function buildGrid(currentPrice: number, currentEquity: number) {
        grid = [];
        upperBound = currentPrice * (1 + GRID_RANGE_PERCENT);
        lowerBound = currentPrice * (1 - GRID_RANGE_PERCENT);
        gridStep = (upperBound - lowerBound) / GRID_LEVELS;
        
        // Compound interest: Allocate leverage based on CURRENT equity
        orderSizeUSD = (currentEquity * LEVERAGE) / (GRID_LEVELS / 2); 

        for (let i = 0; i <= GRID_LEVELS; i++) {
            const p = lowerBound + (i * gridStep);
            if (p < currentPrice) {
                grid.push({ price: p, type: 'BUY', active: true });
            } else {
                grid.push({ price: p, type: 'SELL', active: true });
            }
        }
        gridActive = true;
    }

    function killGrid(currentPrice: number) {
        // Close all positions at market price
        if (positionCoins !== 0) {
            const exitValue = positionCoins * currentPrice;
            const fee = exitValue * TAKER_FEE;
            realizedPnl -= fee;
            stats.feesEarned -= fee;
            positionCoins = 0; 
        }
        gridActive = false;
        grid = [];
    }

    let buffer: MultiCandle[] = [];

    // Initialize first grid
    buildGrid(globalTimeline[0].open, balance);

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        buffer.push(candle);
        if (buffer.length > 100) buffer.shift();

        // 1. Calculate ADX for Regime Filter
        let adx = 0;
        if (buffer.length >= 24) {
            adx = calculateADX(buffer, 24); // 24 * 5m = 2 hour ADX
        }

        const currentEquity = balance + realizedPnl + (positionCoins * candle.close - (positionCoins * (grid[0]?.price || candle.close))); // Rough equity

        // 2. Kill-Switch (Trend Detection)
        if (adx > 30 && gridActive) {
            // Trend started! Kill the grid to avoid liquidation.
            killGrid(candle.close);
            stats.killSwitches++;
            continue;
        }

        // 3. Reactivate Grid when Market is Ranging
        if (adx < 25 && !gridActive) {
            buildGrid(candle.close, currentEquity);
        }

        if (!gridActive) continue;

        // 4. Dynamic Recentering (Price Escapes Grid)
        if (candle.close > upperBound || candle.close < lowerBound) {
            killGrid(candle.close); // Close at market
            stats.recenters++;
            if (adx < 25) {
                buildGrid(candle.close, currentEquity); // Immediately redraw
            }
            continue;
        }

        // 5. Grid Execution
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
        
        if (currentEquity > peakBalance) peakBalance = currentEquity;
        const dd = (peakBalance - currentEquity) / peakBalance * 100;
        if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
    }

    const finalEquity = balance + realizedPnl + (positionCoins * globalTimeline[globalTimeline.length - 1].close);

    console.log(`============================================`);
    console.log(`   BEHEMOTH SMART GRID (5M) BACKTEST`);
    console.log(`   Data: BTC (Year 2022 - Bear Market)`);
    console.log(`============================================`);
    console.log(`Final Equity:     $${finalEquity.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(finalEquity - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`Total Rebates:    $${stats.feesEarned.toFixed(2)}`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Grid Recenters:   ${stats.recenters}`);
    console.log(`Kill-Switches:    ${stats.killSwitches}`);
    console.log(`============================================\n`);
}

runBehemothBacktest().catch(console.error);
