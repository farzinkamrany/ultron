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
const MAKER_FEE = 0.0001;
const SLIPPAGE = 0.006;
const MAX_CONCURRENT_MARKETS = 10;
const MAX_CAPITAL_PER_SLOT = 500000;
const MAX_POSITION_SIZE = 50000;
const MIN_VOLUME_FOR_FILL = 0.75;

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'DOGE', 'BNB', 'XRP', 'DOT', 'AVAX'];
const START_TIMESTAMP = 1514764800000;

// ============================================================
// --- YEAR-BASED CONFIG ---
// ============================================================
function getYearConfig(year: number) {
    if (year === 2020) {
        // YEAR 1: AGGRESSIVE PUSH
        return {
            isYear1: true,
            behemothLeverage: 1.5,
            leviathanLeverage: 8,
            megalodonLeverage: 3,
            behemothWeight: 0.50,
            leviathanWeight: 0.40,
            megalodonWeight: 0.10,
            riskPerTrade: 0.08, // 8% per trade
            positionCapPct: 0.08, // 8% of portfolio max
            leviathanEntryLoose: true, // Loose signals
            description: "🔥 YEAR 1: AGGRESSIVE (Push hard with high leverage)"
        };
    } else {
        // YEARS 2-6: SAFE COMPOUND
        return {
            isYear1: false,
            behemothLeverage: 1.0,
            leviathanLeverage: 2,
            megalodonLeverage: 1.0,
            behemothWeight: 0.85,
            leviathanWeight: 0.10,
            megalodonWeight: 0.05,
            riskPerTrade: 0.03, // 3% per trade
            positionCapPct: 0.05, // 5% of portfolio max
            leviathanEntryLoose: false, // Tight signals
            description: "📈 YEARS 2-6: SAFE COMPOUND (Steady growth)"
        };
    }
}

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

function calculateHighestHigh(candles: MultiCandle[], period: number, offset: number = 0): number {
    let highest = -Infinity;
    const start = Math.max(0, candles.length - period - offset);
    const end = candles.length - offset;
    for (let i = start; i < end; i++) {
        if (candles[i].high > highest) highest = candles[i].high;
    }
    return highest;
}

function calculateLowestLow(candles: MultiCandle[], period: number, offset: number = 0): number {
    let lowest = Infinity;
    const start = Math.max(0, candles.length - period - offset);
    const end = candles.length - offset;
    for (let i = start; i < end; i++) {
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

function isVolumeSpike(candles: MultiCandle[], period: number = 20): boolean {
    if (candles.length < period) return false;
    let volumeSum = 0, volumeSum2 = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        volumeSum += candles[i].volume;
        volumeSum2 += candles[i].volume * candles[i].volume;
    }
    const avgVolume = volumeSum / period;
    const variance = (volumeSum2 / period) - (avgVolume * avgVolume);
    const stdDev = Math.sqrt(variance);
    const currentVolume = candles[candles.length - 1].volume;
    return currentVolume > (avgVolume + 1.5 * stdDev);
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

    public grid: GridLevel[] = [];
    public gridActive = false;
    public positionCoins = 0;
    public avgEntryPrice = 0;
    public realizedGridPnl = 0;
    public orderSizeUSD = 0;
    public gridStep = 0;
    public readonly GRID_LEVELS = 30;

    public leviathanTrade: any = null;
    public megalodonTrade: any = null;

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
    let peakRealizedBalance = INITIAL_CAPITAL;

    let stats = {
        behemothProfit: 0,
        leviathanProfit: 0,
        megalodonProfit: 0,
        leviathanTrades: 0,
        megalodonTrades: 0,
        leviathanWins: 0,
        leviathanPartialTPs: 0,
        switchesToBehemoth: 0,
        switchesToLeviathan: 0,
        maxDrawdown: 0,
        maxRealizedDrawdown: 0,
        velocityBlocks: 0,
    };

    const states: Record<string, SymbolState> = {};
    for (const sym of SYMBOLS) states[sym] = new SymbolState(sym);

    const FOUR_HOURS = 4 * 3600 * 1000;
    let lastYear = new Date(globalTimeline[0].timestamp).getUTCFullYear();
    let yearlyStartBalance = INITIAL_CAPITAL;
    const yearlyResults: Record<number, any> = {};
    let circuitBreakerActive = false;
    let last1HCandle: Record<string, any> = {};
    let positionSizes: Record<string, number> = {};

    for (const candle of globalTimeline) {
        const state = states[candle.symbol];
        const currentYear = new Date(candle.timestamp).getUTCFullYear();
        const yearConfig = getYearConfig(currentYear);

        // 1. Build 4H Candle
        const periodTimestamp = Math.floor(candle.timestamp / FOUR_HOURS) * FOUR_HOURS;
        let candleClosed4H = false;

        if (!state.current4HCandle) {
            state.current4HCandle = { ...candle, timestamp: periodTimestamp };
        } else if (state.current4HCandle.timestamp !== periodTimestamp) {
            state.buffer4H.push({...state.current4HCandle});
            if (state.buffer4H.length > 1000) state.buffer4H.shift();
            state.current4HCandle = { ...candle, timestamp: periodTimestamp };
            candleClosed4H = true;
        } else {
            if (candle.high > state.current4HCandle.high) state.current4HCandle.high = candle.high;
            if (candle.low < state.current4HCandle.low) state.current4HCandle.low = candle.low;
            state.current4HCandle.close = candle.close;
            state.current4HCandle.volume += candle.volume;
        }

        // CIRCUIT BREAKER
        const ONE_HOUR = 3600 * 1000;
        const currentHourPeriod = Math.floor(candle.timestamp / ONE_HOUR);
        if (!last1HCandle[candle.symbol] || last1HCandle[candle.symbol].period !== currentHourPeriod) {
            if (last1HCandle[candle.symbol] && last1HCandle[candle.symbol].close > 0) {
                const hour1Change = (candle.close - last1HCandle[candle.symbol].close) / last1HCandle[candle.symbol].close;
                if (hour1Change < -0.15) {
                    circuitBreakerActive = true;
                }
            }
            last1HCandle[candle.symbol] = { close: candle.close, period: currentHourPeriod };
        }

        // 2. REGIME DETECTION
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

        // 3. DYNAMIC CAPITAL ALLOCATION
        const behemothWeight = state.currentRegime === 'RANGE' ? yearConfig.behemothWeight * 0.95 : yearConfig.behemothWeight * 0.60;
        const leviathanWeight = state.currentRegime === 'TREND' ? yearConfig.leviathanWeight * 1.5 : yearConfig.leviathanWeight;
        const megalodonWeight = state.currentRegime === 'TREND' ? yearConfig.megalodonWeight * 1.5 : yearConfig.megalodonWeight;

        const totalWeight = behemothWeight + leviathanWeight + megalodonWeight;
        const behemothCapital = Math.min((globalBalance * behemothWeight / totalWeight), MAX_CAPITAL_PER_SLOT);
        const leviathanCapital = Math.min((globalBalance * leviathanWeight / totalWeight), MAX_CAPITAL_PER_SLOT);
        const megalodonCapital = Math.min((globalBalance * megalodonWeight / totalWeight), MAX_CAPITAL_PER_SLOT);

        // ============================================================
        // 4. BEHEMOTH — ATR-Adaptive Grid
        // ============================================================
        const priceVelocity = state.buffer4H.length > 6
            ? (candle.close - state.buffer4H[state.buffer4H.length - 6].close) / state.buffer4H[state.buffer4H.length - 6].close
            : 0;
        const fallingKnife = priceVelocity < -0.04;

        if (!state.gridActive && state.buffer4H.length > 20 && !fallingKnife) {
            state.grid = [];
            state.positionCoins = 0;
            state.avgEntryPrice = 0;

            const atr4H = calculateATR(state.buffer4H, 14);
            const atrPct = atr4H / candle.close;
            const dynamicRange = Math.min(Math.max(atrPct * 2.5, 0.04), 0.12);

            const upperBound = candle.close * (1 + dynamicRange);
            const lowerBound = candle.close * (1 - dynamicRange);
            state.gridStep = (upperBound - lowerBound) / state.GRID_LEVELS;
            state.orderSizeUSD = (behemothCapital / (state.GRID_LEVELS / 2)) * yearConfig.behemothLeverage;

            for (let j = 0; j <= state.GRID_LEVELS; j++) {
                const p = lowerBound + (j * state.gridStep);
                if (p < candle.close) state.grid.push({ price: p, type: 'BUY', active: true });
                else state.grid.push({ price: p, type: 'SELL', active: true });
            }
            state.gridActive = true;

        } else if (state.gridActive) {
            if (fallingKnife) stats.velocityBlocks++;

            for (const level of state.grid) {
                if (!level.active) continue;
                
                const orderVolume = state.orderSizeUSD / level.price;
                const volumeAvailable = candle.volume * (1 / (state.GRID_LEVELS / 2));
                const fillRatio = Math.min(1.0, (volumeAvailable / orderVolume) * MIN_VOLUME_FOR_FILL);
                
                if (level.type === 'BUY' && candle.low <= level.price) {
                    const coinsBought = (state.orderSizeUSD / level.price) * fillRatio;
                    if (coinsBought > 0.0001) {
                        const actualCost = coinsBought * level.price;
                        const totalCost = state.positionCoins * state.avgEntryPrice + actualCost;
                        state.positionCoins += coinsBought;
                        state.avgEntryPrice = totalCost / state.positionCoins;
                        state.realizedGridPnl += actualCost * Math.abs(MAKER_FEE);
                        if (fillRatio >= 0.9) level.active = false;
                        const sellLevel = state.grid.find(g => g.price > level.price);
                        if (sellLevel && fillRatio >= 0.9) sellLevel.active = true;
                    }
                }
                else if (level.type === 'SELL' && candle.high >= level.price) {
                    if (state.positionCoins > 0) {
                        const coinsSold = (state.orderSizeUSD / level.price) * fillRatio;
                        if (coinsSold > 0.0001) {
                            const actualValue = coinsSold * level.price;
                            state.realizedGridPnl += (state.gridStep / level.price) * actualValue;
                            state.realizedGridPnl += actualValue * Math.abs(MAKER_FEE);
                            state.positionCoins = Math.max(0, state.positionCoins - coinsSold);
                            if (state.positionCoins < 0.0001) {
                                state.positionCoins = 0;
                                state.avgEntryPrice = 0;
                            }
                            if (fillRatio >= 0.9) level.active = false;
                            const buyLevel = state.grid.slice().reverse().find(g => g.price < level.price);
                            if (buyLevel && fillRatio >= 0.9) buyLevel.active = true;
                        }
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

        // ============================================================
        // 5. LEVIATHAN — Year 1 Aggressive vs Years 2-6 Conservative
        // ============================================================
        if (state.buffer4H.length > 200) {
            const ema50  = calculateEMA(state.buffer4H, 50);
            const ema200 = calculateEMA(state.buffer4H, 200);
            const atr    = calculateATR(state.buffer4H, 14);
            const rsi    = calculateRSI(state.buffer4H, 14);
            const highest20 = calculateHighestHigh(state.buffer4H, 20, 1);
            const lowest20  = calculateLowestLow(state.buffer4H, 20, 1);

            if (state.leviathanTrade) {
                const trade = state.leviathanTrade;

                const quantity = trade.positionSize / trade.entryPrice;
                const unrealizedLoss = Math.abs(trade.action === 'BUY'
                    ? (candle.close - trade.entryPrice) * quantity
                    : (trade.entryPrice - candle.close) * quantity);
                if (unrealizedLoss > trade.positionSize * 0.70) {
                    if (trade.action === 'BUY') {
                        const exitPrice = (candle.close * 0.15) * (1 - SLIPPAGE);
                        const pnl = ((exitPrice - trade.entryPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                        globalBalance += pnl;
                        stats.leviathanProfit += pnl;
                        state.leviathanTrade = null;
                    } else {
                        const exitPrice = (candle.close * 1.85) * (1 + SLIPPAGE);
                        const pnl = ((trade.entryPrice - exitPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                        globalBalance += pnl;
                        stats.leviathanProfit += pnl;
                        state.leviathanTrade = null;
                    }
                } else if (!trade.partialTaken) {
                    const gainPct = trade.action === 'BUY'
                        ? (candle.high - trade.entryPrice) / trade.entryPrice
                        : (trade.entryPrice - candle.low) / trade.entryPrice;

                    const tpTarget = yearConfig.isYear1 ? 0.20 : 0.10; // 20% Y1, 10% Y2-6
                    if (gainPct >= tpTarget) {
                        const halfSize = trade.positionSize * 0.5;
                        const halfQty  = halfSize / trade.entryPrice;
                        const tpPrice  = trade.action === 'BUY'
                            ? trade.entryPrice * (1 + tpTarget) * (1 - SLIPPAGE)
                            : trade.entryPrice * (1 - tpTarget) * (1 + SLIPPAGE);
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
                    const trailStop = calculateLowestLow(state.buffer4H, 30, 1) - atr * 3.0;
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
                    const trailStop = calculateHighestHigh(state.buffer4H, 30, 1) + atr * 3.0;
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
            else if (candleClosed4H) {
                let bullSignal = false, bearSignal = false;

                if (yearConfig.leviathanEntryLoose) {
                    // YEAR 1: LOOSE - More trades
                    bullSignal = ema50 > ema200 && rsi > 40 && rsi < 70;
                    bearSignal = ema50 < ema200 && rsi < 60 && rsi > 30;
                } else {
                    // YEARS 2-6: TIGHT - Quality over quantity
                    bullSignal = ema50 > ema200 && rsi > 50 && rsi < 65 && candle.close > highest20;
                    bearSignal = ema50 < ema200 && rsi < 50 && rsi > 35 && candle.close < lowest20;
                }

                if (bullSignal && !circuitBreakerActive) {
                    const sl = calculateLowestLow(state.buffer4H, 30, 1) - atr * 3.0;
                    const riskDist = Math.max(Math.abs(candle.close - sl) / candle.close, 0.01);
                    const riskAmount = globalBalance * yearConfig.riskPerTrade;
                    let posSize = riskAmount / riskDist;
                    posSize = Math.min(posSize, leviathanCapital * yearConfig.leviathanLeverage);
                    posSize = Math.min(posSize, globalBalance * yearConfig.positionCapPct);
                    
                    state.leviathanTrade = {
                        action: 'BUY',
                        entryPrice: candle.close * (1 + SLIPPAGE),
                        sl: sl,
                        positionSize: posSize,
                        partialTaken: false
                    };
                    stats.leviathanTrades++;
                } else if (bearSignal && !circuitBreakerActive) {
                    const sl = calculateHighestHigh(state.buffer4H, 30, 1) + atr * 3.0;
                    const riskDist = Math.max(Math.abs(sl - candle.close) / candle.close, 0.01);
                    const riskAmount = globalBalance * yearConfig.riskPerTrade;
                    let posSize = riskAmount / riskDist;
                    posSize = Math.min(posSize, leviathanCapital * yearConfig.leviathanLeverage);
                    posSize = Math.min(posSize, globalBalance * yearConfig.positionCapPct);

                    state.leviathanTrade = {
                        action: 'SELL',
                        entryPrice: candle.close * (1 - SLIPPAGE),
                        sl: sl,
                        positionSize: posSize,
                        partialTaken: false
                    };
                    stats.leviathanTrades++;
                }
            }
        }

        // ============================================================
        // 6. MEGALODON — Year 1 Aggressive vs Years 2-6 Conservative
        // ============================================================
        if (state.buffer4H.length > 800) {
            const ema800 = calculateEMA(state.buffer4H, 800);
            const atr = calculateATR(state.buffer4H, 14);

            if (state.megalodonTrade) {
                const trade = state.megalodonTrade;
                const quantity = trade.positionSize / trade.entryPrice;
                const unrealizedLoss = Math.abs(trade.action === 'BUY'
                    ? (candle.close - trade.entryPrice) * quantity
                    : (trade.entryPrice - candle.close) * quantity);
                if (trade.action === 'BUY' && unrealizedLoss > trade.positionSize * 0.70) {
                    const exitPrice = (candle.close * 0.15) * (1 - SLIPPAGE);
                    const pnl = ((exitPrice - trade.entryPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                    globalBalance += pnl;
                    stats.megalodonProfit += pnl;
                    state.megalodonTrade = null;
                } else if (trade.action === 'SELL' && unrealizedLoss > trade.positionSize * 0.70) {
                    const exitPrice = (candle.close * 1.85) * (1 + SLIPPAGE);
                    const pnl = ((trade.entryPrice - exitPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                    globalBalance += pnl;
                    stats.megalodonProfit += pnl;
                    state.megalodonTrade = null;
                } else if (trade.action === 'BUY') {
                    const trailStop = ema800 - atr * 3;
                    trade.sl = Math.max(trade.sl, trailStop);
                    if (candle.low <= trade.sl) {
                        const exitPrice = Math.min(trade.sl, candle.open) * (1 - SLIPPAGE);
                        const quantity  = trade.positionSize / trade.entryPrice;
                        const pnl = ((exitPrice - trade.entryPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                        globalBalance += pnl;
                        stats.megalodonProfit += pnl;
                        state.megalodonTrade = null;
                    }
                } else {
                    const trailStop = ema800 + atr * 3;
                    trade.sl = Math.min(trade.sl, trailStop);
                    if (candle.high >= trade.sl) {
                        const exitPrice = Math.max(trade.sl, candle.open) * (1 + SLIPPAGE);
                        const quantity  = trade.positionSize / trade.entryPrice;
                        const pnl = ((trade.entryPrice - exitPrice) * quantity) - (trade.positionSize * TAKER_FEE * 2);
                        globalBalance += pnl;
                        stats.megalodonProfit += pnl;
                        state.megalodonTrade = null;
                    }
                }
            } else if (candleClosed4H && !circuitBreakerActive) {
                const threshold = yearConfig.isYear1 ? 0.015 : 0.02; // 1.5% Y1, 2% Y2-6
                if (candle.close > ema800 * (1 + threshold)) {
                    let posSize = megalodonCapital * yearConfig.megalodonLeverage;
                    posSize = Math.min(posSize, globalBalance * yearConfig.positionCapPct);
                    state.megalodonTrade = {
                        action: 'BUY',
                        entryPrice: candle.close * (1 + SLIPPAGE),
                        sl: ema800 - atr * 3,
                        positionSize: posSize
                    };
                    stats.megalodonTrades++;
                } else if (candle.close < ema800 * (1 - threshold)) {
                    let posSize = megalodonCapital * yearConfig.megalodonLeverage;
                    posSize = Math.min(posSize, globalBalance * yearConfig.positionCapPct);
                    state.megalodonTrade = {
                        action: 'SELL',
                        entryPrice: candle.close * (1 - SLIPPAGE),
                        sl: ema800 + atr * 3,
                        positionSize: posSize
                    };
                    stats.megalodonTrades++;
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
            if (st.megalodonTrade) {
                const unrealized = st.megalodonTrade.action === 'BUY'
                    ? (candle.close - st.megalodonTrade.entryPrice) * (st.megalodonTrade.positionSize / st.megalodonTrade.entryPrice)
                    : (st.megalodonTrade.entryPrice - candle.close) * (st.megalodonTrade.positionSize / st.megalodonTrade.entryPrice);
                currentEquity += unrealized;
            }
        }

        if (currentEquity > peakBalance) peakBalance = currentEquity;
        const dd = (peakBalance - currentEquity) / peakBalance * 100;
        if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;

        if (globalBalance > peakRealizedBalance) peakRealizedBalance = globalBalance;
        const realizedDD = (peakRealizedBalance - globalBalance) / peakRealizedBalance * 100;
        if (realizedDD > stats.maxRealizedDrawdown) stats.maxRealizedDrawdown = realizedDD;

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
    console.log(` 🚀 ULTRON ORCHESTRATOR v5.10 (Year 1 Aggressive → Safe)`);
    console.log(`============================================================`);
    console.log(`Final Equity:           $${globalBalance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:             $${(globalBalance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`------------------------------------------------------------`);
    console.log(`✅ REAL Drawdown:         ${stats.maxRealizedDrawdown.toFixed(2)}% (realized cash only)`);
    console.log(`📊 MTM Drawdown:          ${stats.maxDrawdown.toFixed(2)}% (includes paper losses)`);
    console.log(`------------------------------------------------------------`);
    console.log(`Behemoth Grid Profit:   $${stats.behemothProfit.toFixed(2)}`);
    console.log(`Leviathan Profit:       $${stats.leviathanProfit.toFixed(2)}`);
    console.log(`Megalodon Profit:       $${stats.megalodonProfit.toFixed(2)}`);
    console.log(`Leviathan Trades:       ${stats.leviathanTrades} | Win Rate: ${winRate}%`);
    console.log(`Megalodon Trades:       ${stats.megalodonTrades}`);
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
