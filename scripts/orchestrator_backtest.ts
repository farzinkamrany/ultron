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
const TAKER_FEE = 0.0004;
const MAKER_FEE = -0.0001;
const SLIPPAGE = 0.001;
const LEVERAGE = 3;

// --- INDICATORS ---
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

interface GridLevel { price: number; type: 'BUY' | 'SELL'; active: boolean; }

async function runOrchestrator() {
    console.log("Loading 5m Data for Orchestrator...");
    const dataFile = 'data/btc_5m_history.csv';
    const btcData = await loadCSV(dataFile, 'BTC');
    
    // We test 2021-2022 (A mix of massive bull trend and massive bear/range)
    const START_TIMESTAMP = 1609459200000; // Jan 1, 2021
    const END_TIMESTAMP = 1672531199000; // Dec 31, 2022
    
    const timeline = btcData
        .filter(c => c.timestamp >= START_TIMESTAMP && c.timestamp <= END_TIMESTAMP)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (timeline.length === 0) { console.log("No data found."); return; }
    console.log(`Loaded ${timeline.length} 5m candles. Commencing Capital Allocation...\n`);

    let balance = INITIAL_CAPITAL;
    let peakBalance = balance;
    
    // System Stats
    let stats = {
        behemothProfit: 0,
        leviathanProfit: 0,
        switchesToBehemoth: 0,
        switchesToLeviathan: 0,
        maxDrawdown: 0
    };

    // --- LEVIATHAN STATE ---
    let leviathanTrade: any = null;
    
    // --- BEHEMOTH STATE ---
    let grid: GridLevel[] = [];
    let gridActive = false;
    let positionCoins = 0;
    let realizedGridPnl = 0;
    let orderSizeUSD = 0;
    let gridStep = 0;
    const GRID_RANGE_PERCENT = 0.05;
    const GRID_LEVELS = 40;

    // --- 4H AGGREGATION ---
    const FOUR_HOURS = 4 * 3600 * 1000;
    let current4HCandle: MultiCandle | null = null;
    const buffer4H: MultiCandle[] = [];

    let currentRegime: 'RANGE' | 'TREND' | 'UNKNOWN' = 'UNKNOWN';

    for (let i = 0; i < timeline.length; i++) {
        const candle = timeline[i];
        
        // 1. Build 4H Candle
        const periodTimestamp = Math.floor(candle.timestamp / FOUR_HOURS) * FOUR_HOURS;
        let candleClosed4H = false;

        if (!current4HCandle) {
            current4HCandle = { ...candle, timestamp: periodTimestamp };
        } else if (current4HCandle.timestamp !== periodTimestamp) {
            buffer4H.push({...current4HCandle});
            if (buffer4H.length > 300) buffer4H.shift();
            current4HCandle = { ...candle, timestamp: periodTimestamp };
            candleClosed4H = true;
        } else {
            if (candle.high > current4HCandle.high) current4HCandle.high = candle.high;
            if (candle.low < current4HCandle.low) current4HCandle.low = candle.low;
            current4HCandle.close = candle.close;
            current4HCandle.volume += candle.volume;
        }

        // 2. Regime Detection on 4H Close
        if (candleClosed4H && buffer4H.length > 50) {
            const adx4H = calculateADX(buffer4H, 14);
            const newRegime = adx4H < 25 ? 'RANGE' : 'TREND';
            
            if (newRegime !== currentRegime) {
                if (newRegime === 'RANGE') stats.switchesToBehemoth++;
                if (newRegime === 'TREND') stats.switchesToLeviathan++;
                currentRegime = newRegime;
            }
        }

        // 3. Behemoth Execution (Runs only in RANGE)
        if (currentRegime === 'RANGE' && !leviathanTrade) {
            if (!gridActive) {
                // Build Grid
                grid = [];
                const upperBound = candle.close * (1 + GRID_RANGE_PERCENT);
                const lowerBound = candle.close * (1 - GRID_RANGE_PERCENT);
                gridStep = (upperBound - lowerBound) / GRID_LEVELS;
                orderSizeUSD = (balance * LEVERAGE) / (GRID_LEVELS / 2); 

                for (let j = 0; j <= GRID_LEVELS; j++) {
                    const p = lowerBound + (j * gridStep);
                    if (p < candle.close) grid.push({ price: p, type: 'BUY', active: true });
                    else grid.push({ price: p, type: 'SELL', active: true });
                }
                gridActive = true;
            } else {
                // Execute Grid Limits
                for (const level of grid) {
                    if (!level.active) continue;
                    if (level.type === 'BUY' && candle.low <= level.price) {
                        const coinsBought = orderSizeUSD / level.price;
                        positionCoins += coinsBought;
                        const rebate = orderSizeUSD * Math.abs(MAKER_FEE);
                        realizedGridPnl += rebate;
                        
                        level.active = false;
                        const sellLevel = grid.find(g => g.price > level.price);
                        if (sellLevel) sellLevel.active = true;
                    } 
                    else if (level.type === 'SELL' && candle.high >= level.price) {
                        if (positionCoins > 0) {
                            const coinsSold = orderSizeUSD / level.price;
                            positionCoins -= coinsSold;
                            const profit = (gridStep / level.price) * orderSizeUSD;
                            realizedGridPnl += profit;
                            const rebate = orderSizeUSD * Math.abs(MAKER_FEE);
                            realizedGridPnl += rebate;
                            
                            level.active = false;
                            const buyLevel = grid.slice().reverse().find(g => g.price < level.price);
                            if (buyLevel) buyLevel.active = true;
                        }
                    }
                }
                
                // Dynamic Recenter
                const upperBound = grid[grid.length-1].price;
                const lowerBound = grid[0].price;
                if (candle.close > upperBound || candle.close < lowerBound) {
                    // Close Grid
                    if (positionCoins !== 0) {
                        const exitValue = positionCoins * candle.close;
                        realizedGridPnl -= exitValue * TAKER_FEE;
                        positionCoins = 0;
                    }
                    gridActive = false;
                }
            }
        } else {
            // If we are not in Range, Kill Behemoth
            if (gridActive) {
                if (positionCoins !== 0) {
                    const exitValue = positionCoins * candle.close;
                    realizedGridPnl -= exitValue * TAKER_FEE;
                    positionCoins = 0;
                }
                gridActive = false;
                
                // Transfer Grid Pnl to Balance
                balance += realizedGridPnl;
                stats.behemothProfit += realizedGridPnl;
                realizedGridPnl = 0;
            }
        }

        // 4. Leviathan Execution (Runs in TREND)
        if (currentRegime === 'TREND' && buffer4H.length > 200 && !gridActive) {
            const ema200 = calculateEMA(buffer4H, 200);
            const atr = calculateATR(buffer4H, 14);
            const highest20 = calculateHighestHigh(buffer4H.slice(0, -1), 20);
            const lowest20 = calculateLowestLow(buffer4H.slice(0, -1), 20);

            if (leviathanTrade) {
                // Trailing Stop checked against 5m candle high/low for realism
                if (leviathanTrade.action === 'BUY') {
                    const trailStop = calculateLowestLow(buffer4H.slice(0, -1), 10) - atr;
                    leviathanTrade.sl = Math.max(leviathanTrade.sl, trailStop);
                    
                    if (candle.low <= leviathanTrade.sl) {
                        const exitPrice = Math.min(leviathanTrade.sl, candle.open) * (1 - SLIPPAGE);
                        const quantity = leviathanTrade.positionSize / leviathanTrade.entryPrice;
                        const pnl = ((exitPrice - leviathanTrade.entryPrice) * quantity) - (leviathanTrade.positionSize * TAKER_FEE * 2);
                        balance += pnl;
                        stats.leviathanProfit += pnl;
                        leviathanTrade = null;
                    }
                } else {
                    const trailStop = calculateHighestHigh(buffer4H.slice(0, -1), 10) + atr;
                    leviathanTrade.sl = Math.min(leviathanTrade.sl, trailStop);
                    
                    if (candle.high >= leviathanTrade.sl) {
                        const exitPrice = Math.max(leviathanTrade.sl, candle.open) * (1 + SLIPPAGE);
                        const quantity = leviathanTrade.positionSize / leviathanTrade.entryPrice;
                        const pnl = ((leviathanTrade.entryPrice - exitPrice) * quantity) - (leviathanTrade.positionSize * TAKER_FEE * 2);
                        balance += pnl;
                        stats.leviathanProfit += pnl;
                        leviathanTrade = null;
                    }
                }
            } 
            else if (candleClosed4H) { // Only Enter on 4H Close
                if (candle.close > ema200 && candle.close > highest20) {
                    leviathanTrade = {
                        action: 'BUY',
                        entryPrice: candle.close * (1 + SLIPPAGE),
                        sl: calculateLowestLow(buffer4H.slice(0, -1), 10) - atr,
                        positionSize: balance * LEVERAGE
                    };
                } else if (candle.close < ema200 && candle.close < lowest20) {
                    leviathanTrade = {
                        action: 'SELL',
                        entryPrice: candle.close * (1 - SLIPPAGE),
                        sl: calculateHighestHigh(buffer4H.slice(0, -1), 10) + atr,
                        positionSize: balance * LEVERAGE
                    };
                }
            }
        }

        // Track Equity
        const currentEquity = balance + realizedGridPnl + (positionCoins * candle.close - (positionCoins * (grid[0]?.price || candle.close)));
        if (currentEquity > peakBalance) peakBalance = currentEquity;
        const dd = (peakBalance - currentEquity) / peakBalance * 100;
        if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
    }

    const finalEquity = balance + realizedGridPnl + (positionCoins * timeline[timeline.length - 1].close);

    console.log(`============================================`);
    console.log(`   ULTRON ORCHESTRATOR (THE MASTER BRAIN)`);
    console.log(`   Data: BTC (2021-2022 Bull & Bear Markets)`);
    console.log(`============================================`);
    console.log(`Final Equity:         $${finalEquity.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:           $${(finalEquity - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:         ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`--------------------------------------------`);
    console.log(`Behemoth Grid Profit: $${stats.behemothProfit.toFixed(2)} (Range Regimes)`);
    console.log(`Leviathan Profit:     $${stats.leviathanProfit.toFixed(2)} (Trend Regimes)`);
    console.log(`--------------------------------------------`);
    console.log(`Regime Shifts (T->R): ${stats.switchesToBehemoth}`);
    console.log(`Regime Shifts (R->T): ${stats.switchesToLeviathan}`);
    console.log(`============================================\n`);
}

runOrchestrator().catch(console.error);
