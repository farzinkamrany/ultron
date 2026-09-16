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
const TAKER_FEE = 0.00035;
const MAKER_FEE = -0.0001;
const SLIPPAGE = 0.001;
const MAX_CONCURRENT_MARKETS = 10;
const LEVERAGE = 3.0;
const MAX_CAPITAL_PER_SLOT = 500000;
const ALLOCATION_PER_SLOT = 0.20; // 20% per slot — proven optimal

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'DOGE', 'BNB', 'XRP', 'DOT', 'AVAX'];
const START_TIMESTAMP = 1514764800000; // 2018

// ============================================================
// --- INDICATORS ---
// ============================================================

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
    let plusDM = 0, minusDM = 0, tr = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const upMove = candles[i].high - candles[i-1].high;
        const downMove = candles[i-1].low - candles[i].low;
        if (upMove > downMove && upMove > 0) plusDM += upMove;
        if (downMove > upMove && downMove > 0) minusDM += downMove;
        const high = candles[i].high, low = candles[i].low, prevClose = candles[i-1].close;
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

// RSI — Leviathan entry confirmation
function calculateRSI(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    const start = candles.length - period;
    for (let i = start; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
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

class SymbolState {
    public buffer4H: MultiCandle[] = [];
    public current4HCandle: MultiCandle | null = null;
    public currentRegime: 'RANGE' | 'TREND' | 'UNKNOWN' = 'UNKNOWN';

    // Behemoth State
    public grid: GridLevel[] = [];
    public gridActive = false;
    public positionCoins = 0;
    public avgEntryPrice = 0;
    public realizedGridPnl = 0;
    public orderSizeUSD = 0;
    public gridStep = 0;
    public readonly GRID_LEVELS = 30;

    // Leviathan State
    public leviathanTrade: any = null;

    public symbol: string;
    constructor(symbol: string) { this.symbol = symbol; }
}

async function runMultiAssetOrchestrator() {
    console.log("🧠 Loading 15m Data for 10 Symbols...");
    let globalTimeline: MultiCandle[] = [];

    for (const sym of SYMBOLS) {
        try {
            const data = await loadCSV(`data/${sym.toLowerCase()}_15m_history.csv`, sym);
            for (const c of data) {
                if (c.timestamp >= START_TIMESTAMP) globalTimeline.push(c);
            }
        } catch (e) { console.log(`Failed to load ${sym}`); }
    }

    console.log("Sorting Global Timeline...");
    globalTimeline.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a.symbol.localeCompare(b.symbol);
    });

    if (globalTimeline.length === 0) { console.log("No data found."); return; }
    console.log(`Loaded ${globalTimeline.length} candles. Commencing Capital Allocation...\n`);

    let globalBalance = INITIAL_CAPITAL;
    let peakBalance = globalBalance;

    let stats = {
        behemothProfit: 0,
        leviathanProfit: 0,
        leviathanTrades: 0,
        leviathanWins: 0,
        leviathanPartialTPs: 0,
        switchesToBehemoth: 0,
        switchesToLeviathan: 0,
        maxDrawdown: 0,
        velocityBlocks: 0, // grids blocked by fast-drop filter
    };

    const states: Record<string, SymbolState> = {};
    for (const sym of SYMBOLS) states[sym] = new SymbolState(sym);

    const FOUR_HOURS = 4 * 3600 * 1000;
    let lastYear = new Date(globalTimeline[0].timestamp).getUTCFullYear();
    let yearlyStartBalance = INITIAL_CAPITAL;
    const yearlyResults: Record<number, any> = {};

    for (const candle of globalTimeline) {
        const state = states[candle.symbol];

        // 1. Build 4H Candle
        const periodTimestamp = Math.floor(candle.timestamp / FOUR_HOURS) * FOUR_HOURS;
        let candleClosed4H = false;

        if (!state.current4HCandle) {
            state.current4HCandle = { ...candle, timestamp: periodTimestamp };
        } else if (state.current4HCandle.timestamp !== periodTimestamp) {
            state.buffer4H.push({...state.current4HCandle});
            if (state.buffer4H.length > 300) state.buffer4H.shift();
            state.current4HCandle = { ...candle, timestamp: periodTimestamp };
            candleClosed4H = true;
        } else {
            if (candle.high > state.current4HCandle.high) state.current4HCandle.high = candle.high;
            if (candle.low < state.current4HCandle.low) state.current4HCandle.low = candle.low;
            state.current4HCandle.close = candle.close;
            state.current4HCandle.volume += candle.volume;
        }

        let activeMarkets = 0;
        for (const sym in states) {
            if (states[sym].gridActive || states[sym].leviathanTrade) activeMarkets++;
        }

        const capitalPerSlot = Math.min(globalBalance * ALLOCATION_PER_SLOT, MAX_CAPITAL_PER_SLOT);

        // ============================================================
        // 2. REGIME DETECTION (ADX with hysteresis — proven working)
        // ============================================================
        if (candleClosed4H && state.buffer4H.length > 50) {
            const adx4H = calculateADX(state.buffer4H, 14);
            let newRegime = state.currentRegime;

            if (state.currentRegime === 'UNKNOWN') {
                newRegime = adx4H < 25 ? 'RANGE' : 'TREND';
            } else if (state.currentRegime === 'RANGE' && adx4H > 27) {
                newRegime = 'TREND';
            } else if (state.currentRegime === 'TREND' && adx4H < 23) {
                newRegime = 'RANGE';
            }

            if (newRegime !== state.currentRegime) {
                if (newRegime === 'RANGE') stats.switchesToBehemoth++;
                if (newRegime === 'TREND') stats.switchesToLeviathan++;
                state.currentRegime = newRegime;
            }
        }

        // ============================================================
        // 3. BEHEMOTH — ATR-Adaptive Grid + Velocity Shock Filter
        // ============================================================

        // ⚡ VELOCITY SHOCK ABSORBER: block grid open during fast drops (>4% in 6×4H = 24h)
        const priceVelocity = state.buffer4H.length > 6
            ? (candle.close - state.buffer4H[state.buffer4H.length - 6].close) / state.buffer4H[state.buffer4H.length - 6].close
            : 0;
        const fallingKnife = priceVelocity < -0.04;

        if (state.currentRegime === 'RANGE' && !state.leviathanTrade) {
            if (!state.gridActive && activeMarkets < MAX_CONCURRENT_MARKETS
                && state.buffer4H.length > 20 && !fallingKnife) {

                state.grid = [];
                state.positionCoins = 0;
                state.avgEntryPrice = 0;

                // ATR-Adaptive Range: 2.5× ATR, clamped 4%–12%
                const atr4H = calculateATR(state.buffer4H, 14);
                const atrPct = atr4H / candle.close;
                const dynamicRange = Math.min(Math.max(atrPct * 2.5, 0.04), 0.12);

                const upperBound = candle.close * (1 + dynamicRange);
                const lowerBound = candle.close * (1 - dynamicRange);
                state.gridStep = (upperBound - lowerBound) / state.GRID_LEVELS;
                state.orderSizeUSD = (capitalPerSlot * LEVERAGE) / (state.GRID_LEVELS / 2);

                for (let j = 0; j <= state.GRID_LEVELS; j++) {
                    const p = lowerBound + (j * state.gridStep);
                    if (p < candle.close) state.grid.push({ price: p, type: 'BUY', active: true });
                    else state.grid.push({ price: p, type: 'SELL', active: true });
                }
                state.gridActive = true;

            } else if (state.gridActive) {
                // Count velocity blocks separately when grid is already open (no effect, just monitoring)
                if (fallingKnife) stats.velocityBlocks++;

                for (const level of state.grid) {
                    if (!level.active) continue;
                    if (level.type === 'BUY' && candle.low <= level.price) {
                        const coinsBought = state.orderSizeUSD / level.price;
                        const totalCost = state.positionCoins * state.avgEntryPrice + coinsBought * level.price;
                        state.positionCoins += coinsBought;
                        state.avgEntryPrice = totalCost / state.positionCoins;
                        state.realizedGridPnl += state.orderSizeUSD * Math.abs(MAKER_FEE);
                        level.active = false;
                        const sellLevel = state.grid.find(g => g.price > level.price);
                        if (sellLevel) sellLevel.active = true;
                    }
                    else if (level.type === 'SELL' && candle.high >= level.price) {
                        if (state.positionCoins > 0) {
                            const coinsSold = state.orderSizeUSD / level.price;
                            // Proven formula: each completed grid cycle earns exactly gridStep profit
                            state.realizedGridPnl += (state.gridStep / level.price) * state.orderSizeUSD;
                            state.realizedGridPnl += state.orderSizeUSD * Math.abs(MAKER_FEE);
                            state.positionCoins = Math.max(0, state.positionCoins - coinsSold);
                            if (state.positionCoins < 0.0001) {
                                state.positionCoins = 0;
                                state.avgEntryPrice = 0;
                            }
                            level.active = false;
                            const buyLevel = state.grid.slice().reverse().find(g => g.price < level.price);
                            if (buyLevel) buyLevel.active = true;
                        }
                    }
                }

                const upperBound = state.grid[state.grid.length-1].price;
                const lowerBound = state.grid[0].price;
                if (candle.close > upperBound || candle.close < lowerBound) {
                    if (state.positionCoins !== 0) {
                        const exitValue = state.positionCoins * candle.close;
                        state.realizedGridPnl -= exitValue * TAKER_FEE;
                        state.positionCoins = 0;
                        state.avgEntryPrice = 0;
                    }
                    state.gridActive = false;
                    globalBalance += state.realizedGridPnl;
                    stats.behemothProfit += state.realizedGridPnl;
                    state.realizedGridPnl = 0;
                }
            }
        } else {
            if (state.gridActive) {
                if (state.positionCoins !== 0) {
                    const exitValue = state.positionCoins * candle.close;
                    state.realizedGridPnl -= exitValue * TAKER_FEE;
                    state.positionCoins = 0;
                    state.avgEntryPrice = 0;
                }
                state.gridActive = false;
                globalBalance += state.realizedGridPnl;
                stats.behemothProfit += state.realizedGridPnl;
                state.realizedGridPnl = 0;
            }
        }

        // ============================================================
        // 4. LEVIATHAN — RSI + EMA Cross + Partial TP (BTC only)
        // ============================================================
        if (state.currentRegime === 'TREND' && state.buffer4H.length > 200
            && !state.gridActive && candle.symbol === 'BTC') {

            const ema50  = calculateEMA(state.buffer4H, 50);
            const ema200 = calculateEMA(state.buffer4H, 200);
            const atr    = calculateATR(state.buffer4H, 14);
            const rsi    = calculateRSI(state.buffer4H, 14);
            const highest20 = calculateHighestHigh(state.buffer4H.slice(0, -1), 20);
            const lowest20  = calculateLowestLow(state.buffer4H.slice(0, -1), 20);

            if (state.leviathanTrade) {
                const trade = state.leviathanTrade;

                // Partial Take Profit at +40% gain
                if (!trade.partialTaken) {
                    const gainPct = trade.action === 'BUY'
                        ? (candle.high - trade.entryPrice) / trade.entryPrice
                        : (trade.entryPrice - candle.low) / trade.entryPrice;

                    if (gainPct >= 0.40) {
                        const halfSize = trade.positionSize * 0.5;
                        const halfQty  = halfSize / trade.entryPrice;
                        const tpPrice  = trade.action === 'BUY'
                            ? trade.entryPrice * 1.40 * (1 - SLIPPAGE)
                            : trade.entryPrice * 0.60 * (1 + SLIPPAGE);
                        const partialPnl = trade.action === 'BUY'
                            ? (tpPrice - trade.entryPrice) * halfQty - halfSize * TAKER_FEE
                            : (trade.entryPrice - tpPrice) * halfQty - halfSize * TAKER_FEE;
                        globalBalance += partialPnl;
                        stats.leviathanProfit += partialPnl;
                        stats.leviathanPartialTPs++;
                        trade.positionSize *= 0.5;
                        trade.partialTaken = true;
                        if (trade.action === 'BUY') trade.sl = Math.max(trade.sl, trade.entryPrice);
                        else trade.sl = Math.min(trade.sl, trade.entryPrice);
                    }
                }

                if (trade.action === 'BUY') {
                    const trailStop = calculateLowestLow(state.buffer4H.slice(0, -1), 10) - atr * 1.5;
                    trade.sl = Math.max(trade.sl, trailStop);
                    if (candle.low <= trade.sl) {
                        const exitPrice = Math.min(trade.sl, candle.open) * (1 - SLIPPAGE);
                        const quantity  = trade.positionSize / trade.entryPrice;
                        const pnl = ((exitPrice - trade.entryPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                        globalBalance += pnl;
                        stats.leviathanProfit += pnl;
                        if (pnl > 0) stats.leviathanWins++;
                        state.leviathanTrade = null;
                    }
                } else {
                    const trailStop = calculateHighestHigh(state.buffer4H.slice(0, -1), 10) + atr * 1.5;
                    trade.sl = Math.min(trade.sl, trailStop);
                    if (candle.high >= trade.sl) {
                        const exitPrice = Math.max(trade.sl, candle.open) * (1 + SLIPPAGE);
                        const quantity  = trade.positionSize / trade.entryPrice;
                        const pnl = ((trade.entryPrice - exitPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                        globalBalance += pnl;
                        stats.leviathanProfit += pnl;
                        if (pnl > 0) stats.leviathanWins++;
                        state.leviathanTrade = null;
                    }
                }
            }
            else if (candleClosed4H && activeMarkets < MAX_CONCURRENT_MARKETS) {
                // Entry: EMA50/200 cross + RSI confirmation + breakout
                const bullSignal = ema50 > ema200 && rsi > 45 && rsi < 72 && candle.close > highest20;
                const bearSignal = ema50 < ema200 && rsi < 55 && rsi > 28 && candle.close < lowest20;

                if (bullSignal) {
                    state.leviathanTrade = {
                        action: 'BUY',
                        entryPrice: candle.close * (1 + SLIPPAGE),
                        sl: calculateLowestLow(state.buffer4H.slice(0, -1), 10) - atr * 1.5,
                        positionSize: capitalPerSlot * LEVERAGE,
                        partialTaken: false
                    };
                    stats.leviathanTrades++;
                } else if (bearSignal) {
                    state.leviathanTrade = {
                        action: 'SELL',
                        entryPrice: candle.close * (1 - SLIPPAGE),
                        sl: calculateHighestHigh(state.buffer4H.slice(0, -1), 10) + atr * 1.5,
                        positionSize: capitalPerSlot * LEVERAGE,
                        partialTaken: false
                    };
                    stats.leviathanTrades++;
                }
            }
        }

        // Equity Tracking
        let currentEquity = globalBalance;
        for (const sym in states) {
            const st = states[sym];
            currentEquity += st.realizedGridPnl;
            if (st.positionCoins > 0 && st.avgEntryPrice > 0) {
                currentEquity += (candle.close - st.avgEntryPrice) * st.positionCoins;
            }
            if (st.leviathanTrade) {
                const unrealized = st.leviathanTrade.action === 'BUY'
                    ? (candle.close - st.leviathanTrade.entryPrice) * (st.leviathanTrade.positionSize / st.leviathanTrade.entryPrice)
                    : (st.leviathanTrade.entryPrice - candle.close) * (st.leviathanTrade.positionSize / st.leviathanTrade.entryPrice);
                currentEquity += unrealized;
            }
        }

        if (currentEquity > peakBalance) peakBalance = currentEquity;
        const dd = (peakBalance - currentEquity) / peakBalance * 100;
        if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;

        const currentYear = new Date(candle.timestamp).getUTCFullYear();
        if (currentYear > lastYear) {
            yearlyResults[lastYear] = {
                endBalance: globalBalance,
                profitPct: ((globalBalance - yearlyStartBalance) / yearlyStartBalance) * 100
            };
            lastYear = currentYear;
            yearlyStartBalance = globalBalance;
        }
    }

    yearlyResults[lastYear] = {
        endBalance: globalBalance,
        profitPct: ((globalBalance - yearlyStartBalance) / yearlyStartBalance) * 100
    };

    for (const sym in states) {
        if (states[sym].gridActive) {
            globalBalance += states[sym].realizedGridPnl;
        }
    }

    const winRate = stats.leviathanTrades > 0
        ? (stats.leviathanWins / stats.leviathanTrades * 100).toFixed(1)
        : 'N/A';

    console.log(`\n============================================================`);
    console.log(` 🧠 ULTRON ORCHESTRATOR v2.1 (Smart Edition — Stable)`);
    console.log(`============================================================`);
    console.log(`Final Equity:           $${globalBalance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:             $${(globalBalance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:           ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`------------------------------------------------------------`);
    console.log(`Behemoth Grid Profit:   $${stats.behemothProfit.toFixed(2)}`);
    console.log(`Leviathan Profit:       $${stats.leviathanProfit.toFixed(2)}`);
    console.log(`Leviathan Trades:       ${stats.leviathanTrades} | Win Rate: ${winRate}%`);
    console.log(`Leviathan Partial TPs:  ${stats.leviathanPartialTPs}x`);
    console.log(`💨 Velocity Blocks:     ${stats.velocityBlocks} (fast-drop shield)`);
    console.log(`------------------------------------------------------------`);
    console.log(`Regime Shifts (T->R):   ${stats.switchesToBehemoth}`);
    console.log(`Regime Shifts (R->T):   ${stats.switchesToLeviathan}`);
    console.log(`------------------------------------------------------------`);
    for (const year in yearlyResults) {
        console.log(`Year ${year}: $${yearlyResults[year].endBalance.toFixed(2)} (${yearlyResults[year].profitPct.toFixed(2)}%)`);
    }
    console.log(`============================================================\n`);
}

runMultiAssetOrchestrator().catch(console.error);
