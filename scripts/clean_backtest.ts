import fs from 'fs';
import path from 'path';

// --- INTERFACES ---
interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface MultiCandle extends Candle {
    symbol: string;
}

interface Trade {
    symbol: string;
    action: 'BUY' | 'SELL';
    entryPrice: number;
    entryTime: number;
    sl: number;
    initialSl: number;
    tp: number;
    pyramidStage: number;
    balanceAtEntry: number;
    blendedEntry: number;
    candlesSinceEntry: number;
}

// --- CONFIGURATION ---
const INITIAL_CAPITAL = 1000;
const MAKER_FEE = 0.0004;
const HARD_POSITION_CAP = 500000;

// SNOWBALL STRATEGY: Dynamic leverage scaling (20x early, 2x late)
function getDynamicLeverage(balance: number): number {
    if (balance < 5000) return 20;
    if (balance < 25000) return 15;
    if (balance < 50000) return 10;
    if (balance < 250000) return 5;
    return 2;
}

// --- MATH UTILS ---
function calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;
    const k = 2 / (period + 1);
    let ema = candles[candles.length - period].close;
    for (let i = candles.length - period + 1; i < candles.length; i++) {
        ema = (candles[i].close * k) + (ema * (1 - k));
    }
    return ema;
}

function calculateATR(candles: Candle[], period: number = 14): number {
    if (candles.length < 2) return 0;
    const actualPeriod = Math.min(period, candles.length - 1);
    let trSum = 0;
    for (let i = candles.length - actualPeriod; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trSum += tr;
    }
    return trSum / actualPeriod;
}

async function loadCSV(filePath: string, symbol: string): Promise<MultiCandle[]> {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) return [];
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n').slice(1);
    const data: MultiCandle[] = [];
    
    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        data.push({
            timestamp: parseInt(parts[0]),
            open: parseFloat(parts[1]),
            high: parseFloat(parts[2]),
            low: parseFloat(parts[3]),
            close: parseFloat(parts[4]),
            volume: parseFloat(parts[5]),
            symbol
        });
    }
    return data;
}

async function runCleanBacktest() {
    console.log("Loading Assets...");
    const symbols = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'BNB', 'XRP', 'DOGE', 'AVAX'];
    let globalTimeline: MultiCandle[] = [];

    for (const sym of symbols) {
        const data = await loadCSV(`data/${sym.toLowerCase()}_1h_history.csv`, sym); 
        globalTimeline = globalTimeline.concat(data);
    }

    // fallback to 15m if 1h doesn't exist
    if (globalTimeline.length === 0) {
        for (const sym of symbols) {
            const data = await loadCSV(`data/${sym.toLowerCase()}_15m_history.csv`, sym); 
            globalTimeline = globalTimeline.concat(data);
        }
    }

    console.log("Sorting Timeline...");
    const START_TIMESTAMP = 1514764800000; // Jan 1, 2018
    globalTimeline = globalTimeline
        .filter(c => c.timestamp >= START_TIMESTAMP)
        .sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Simulation starting with ${globalTimeline.length} total events.\n`);

    let balance = INITIAL_CAPITAL;
    let peakBalance = INITIAL_CAPITAL;
    let maxDrawdown = 0;
    
    let stats = {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakEvens: 0,
        feesPaid: 0
    };

    let activeTrades: Record<string, Trade> = {};
    const buffers: Record<string, Candle[]> = {};
    symbols.forEach(s => buffers[s] = []);

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        const { symbol, timestamp, close: currentPrice } = candle;

        buffers[symbol].push(candle);
        if (buffers[symbol].length > 1000) buffers[symbol].shift();

        const candles = buffers[symbol];
        if (candles.length < 800) continue; // Need enough data for 800 EMA

        // --- MANAGE OPEN TRADES ---
        let activeTrade = activeTrades[symbol];
        if (activeTrade) {
            activeTrade.candlesSinceEntry++;
            if (balance > peakBalance) peakBalance = balance;
            
            const dd = (peakBalance - balance) / peakBalance * 100;
            if (dd > maxDrawdown) maxDrawdown = dd;

            let closed = false;
            let exitPrice = 0;

            const effectiveEntry = activeTrade.blendedEntry || activeTrade.entryPrice;
            const breakEvenLong = effectiveEntry * (1 + (MAKER_FEE * 3));
            const breakEvenShort = effectiveEntry * (1 - (MAKER_FEE * 3));

            if (activeTrade.action === 'BUY') {
                const riskDistance = activeTrade.entryPrice - activeTrade.initialSl;
                const currentR = (currentPrice - activeTrade.entryPrice) / riskDistance;

                if (candle.low <= activeTrade.sl) {
                    exitPrice = activeTrade.sl * 0.9995;
                    closed = true;
                } else if (candle.high >= activeTrade.tp) {
                    exitPrice = activeTrade.tp;
                    closed = true;
                } else {
                    // Early Break Even
                    if (currentR >= 0.75 && activeTrade.sl < breakEvenLong) {
                        activeTrade.sl = breakEvenLong;
                    }
                    // Step Trailing
                    if (currentR >= 1.0) activeTrade.sl = Math.max(activeTrade.sl, activeTrade.entryPrice + riskDistance * 0.2);
                    if (currentR >= 2.0) activeTrade.sl = Math.max(activeTrade.sl, activeTrade.entryPrice + riskDistance * 1.0);
                    if (currentR >= 3.0) activeTrade.sl = Math.max(activeTrade.sl, activeTrade.entryPrice + riskDistance * 2.0);
                    
                    // Pyramiding
                    if (currentR >= 2.0 && activeTrade.pyramidStage === 0) {
                        activeTrade.pyramidStage = 1;
                        activeTrade.blendedEntry = (activeTrade.entryPrice + currentPrice) / 2;
                    }
                    if (currentR >= 4.0 && activeTrade.pyramidStage === 1) {
                        activeTrade.pyramidStage = 2;
                        activeTrade.blendedEntry = (activeTrade.blendedEntry * 2 + currentPrice) / 3;
                    }
                }
            } else {
                // SELL
                const riskDistance = activeTrade.initialSl - activeTrade.entryPrice;
                const currentR = (activeTrade.entryPrice - currentPrice) / riskDistance;

                if (candle.high >= activeTrade.sl) {
                    exitPrice = activeTrade.sl * 1.0005;
                    closed = true;
                } else if (candle.low <= activeTrade.tp) {
                    exitPrice = activeTrade.tp;
                    closed = true;
                } else {
                    // Early Break Even
                    if (currentR >= 0.75 && activeTrade.sl > breakEvenShort) {
                        activeTrade.sl = breakEvenShort;
                    }
                    // Step Trailing
                    if (currentR >= 1.0) activeTrade.sl = Math.min(activeTrade.sl, activeTrade.entryPrice - riskDistance * 0.2);
                    if (currentR >= 2.0) activeTrade.sl = Math.min(activeTrade.sl, activeTrade.entryPrice - riskDistance * 1.0);
                    if (currentR >= 3.0) activeTrade.sl = Math.min(activeTrade.sl, activeTrade.entryPrice - riskDistance * 2.0);
                    
                    // Pyramiding
                    if (currentR >= 2.0 && activeTrade.pyramidStage === 0) {
                        activeTrade.pyramidStage = 1;
                        activeTrade.blendedEntry = (activeTrade.entryPrice + currentPrice) / 2;
                    }
                    if (currentR >= 4.0 && activeTrade.pyramidStage === 1) {
                        activeTrade.pyramidStage = 2;
                        activeTrade.blendedEntry = (activeTrade.blendedEntry * 2 + currentPrice) / 3;
                    }
                }
            }

            if (closed) {
                let rawPnl = 0;
                let leverage = getDynamicLeverage(activeTrade.balanceAtEntry);
                
                // Position Sizing: 1% risk per trade.
                const riskPerc = Math.abs(activeTrade.entryPrice - activeTrade.initialSl) / activeTrade.entryPrice;
                let basePositionSize = activeTrade.balanceAtEntry * 0.01 / riskPerc; 
                
                const maxPositionSize = activeTrade.balanceAtEntry * leverage;
                if (basePositionSize > maxPositionSize) basePositionSize = maxPositionSize;
                if (basePositionSize > HARD_POSITION_CAP) basePositionSize = HARD_POSITION_CAP;

                // Pyramiding multiplier
                let volumeMultiplier = 1.0;
                if (activeTrade.pyramidStage === 1) volumeMultiplier = 1.5;
                if (activeTrade.pyramidStage === 2) volumeMultiplier = 2.0;

                const actualEntryVol = basePositionSize * volumeMultiplier;
                const actualExitVol = basePositionSize * volumeMultiplier;

                // Move percentage calculated from Blended Entry
                const finalEntry = activeTrade.blendedEntry || activeTrade.entryPrice;
                const movePerc = activeTrade.action === 'BUY' 
                    ? (exitPrice - finalEntry) / finalEntry 
                    : (finalEntry - exitPrice) / finalEntry;

                rawPnl = actualEntryVol * movePerc;

                const slippage = 0.0004; // Conservative slippage
                const entryFee = actualEntryVol * (MAKER_FEE + slippage);
                const exitFee = actualExitVol * (MAKER_FEE + slippage);
                
                const pnl = rawPnl - entryFee - exitFee;
                balance += pnl;

                stats.totalTrades++;
                stats.feesPaid += (entryFee + exitFee);

                if (pnl > 0) stats.wins++;
                else if (pnl < 0 && Math.abs(pnl) > entryFee * 2) stats.losses++;
                else stats.breakEvens++;

                delete activeTrades[symbol];
            }
            continue; // Skip entry logic if already in a trade
        }

        // --- ENTRY LOGIC ---
        // Bollinger Bands
        const bbPeriod = 50;
        let sum = 0;
        for (let j = candles.length - bbPeriod; j < candles.length; j++) sum += candles[j].close;
        const bbSma = sum / bbPeriod;
        let variance = 0;
        for (let j = candles.length - bbPeriod; j < candles.length; j++) variance += Math.pow(candles[j].close - bbSma, 2);
        const bbStdDev = Math.sqrt(variance / bbPeriod);
        
        const upperBB = bbSma + (bbStdDev * 2);
        const lowerBB = bbSma - (bbStdDev * 2);

        const macroEma = calculateEMA(candles, 800);
        const atr = calculateATR(candles, 14);

        if (Object.keys(activeTrades).length < 3) {
            let action: 'BUY' | 'SELL' | null = null;
            let sl = 0;
            let tp = 0;

            if (currentPrice > macroEma && candle.close > upperBB) {
                action = 'BUY';
                sl = currentPrice - (atr * 2); // 2 ATR Stop Loss
                tp = currentPrice + ((currentPrice - sl) * 4.0); // 4.0R Hard TP
            } else if (currentPrice < macroEma && candle.close < lowerBB) {
                action = 'SELL';
                sl = currentPrice + (atr * 2);
                tp = currentPrice - ((sl - currentPrice) * 4.0);
            }

            if (action) {
                activeTrades[symbol] = {
                    symbol,
                    action,
                    entryPrice: currentPrice,
                    entryTime: timestamp,
                    sl,
                    initialSl: sl,
                    tp,
                    pyramidStage: 0,
                    balanceAtEntry: balance,
                    blendedEntry: currentPrice,
                    candlesSinceEntry: 0
                };
            }
        }
    }

    console.log("============================================");
    console.log("   CLEAN BACKTEST ENGINE RESULTS");
    console.log("============================================");
    console.log(`Final Balance:    $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     ${maxDrawdown.toFixed(2)}%`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Win Rate:         ${((stats.wins / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Loss Rate:        ${((stats.losses / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Break-Evens:      ${((stats.breakEvens / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Total Fees Paid:  $${stats.feesPaid.toFixed(2)}`);
    console.log("============================================");
}

runCleanBacktest().catch(console.error);
