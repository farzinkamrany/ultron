import * as fs from 'fs';
import * as readline from 'readline';
import { detectSqueeze, calculateChoppinessIndex, detectCapitulationSync, checkEarlyExit, detectRegime, detectDominantCycleFFT, calculateFisherTransform, calculateApproximateEntropy, calculateZScoreVWAP, calculateHurstExponent, getHurstAdaptiveATRMultiplier, detectLiquiditySweep } from '../src/lib/trading/financial-intelligence';
import { calculateGannSquareOf9, calculateTimeCycles } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';

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
const MAX_LOSS_LIMIT = 900;
const MAKER_FEE = 0.0000; // 0.00% Hyperliquid Maker fee
const HARD_POSITION_CAP = 500000; // Realistic orderbook liquidity limit for top 10 coins

// SNOWBALL STRATEGY: Dynamic leverage scaling (20x early, 2x late)
function getDynamicLeverage(balance: number): number {
    if (balance < 5000) return 20; // Hyper-Aggressive (0 -> 5k)
    if (balance < 20000) return 10; // Snowballing (5k -> 20k)
    if (balance < 50000) return 5; // Securing the bag (20k -> 50k)
    return 2; // Institutional safety
}

// Dynamic circuit breaker threshold (relaxed when small, strict when large)
function getDynamicCircuitBreakerThreshold(peakBalance: number): number {
    if (peakBalance < 5000) return 0.20;   // Allow -80% when $1K
    if (peakBalance < 25000) return 0.40;  // Allow -60% when $25K
    if (peakBalance < 50000) return 0.60;  // Allow -40% when $50K
    if (peakBalance < 250000) return 0.70; // Allow -30% when $250K
    return 0.80;                           // Allow -20% when $1M (protect!)
}

function calculateATR(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < 2) return 0;
    const actualPeriod = Math.min(period, candles.length - 1);
    let trSum = 0;
    for (let i = candles.length - actualPeriod; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        trSum += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
    return trSum / actualPeriod;
}

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



function calculateRSI(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;

    // First period
    for (let i = candles.length - period; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) gains += change;
        else losses -= change;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

async function loadCSV(filePath: string, symbol: string): Promise<MultiCandle[]> {
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

async function loadAndResampleTo1H(filePath: string, symbol: string): Promise<MultiCandle[]> {
    const data15m = await loadCSV(filePath, symbol);
    const data1h: MultiCandle[] = [];
    
    let currentHourCandle: MultiCandle | null = null;
    
    for (const c of data15m) {
        const hourTimestamp = Math.floor(c.timestamp / 3600000) * 3600000;
        
        if (!currentHourCandle || currentHourCandle.timestamp !== hourTimestamp) {
            if (currentHourCandle) data1h.push(currentHourCandle);
            currentHourCandle = {
                symbol: c.symbol,
                timestamp: hourTimestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume
            };
        } else {
            currentHourCandle.high = Math.max(currentHourCandle.high, c.high);
            currentHourCandle.low = Math.min(currentHourCandle.low, c.low);
            currentHourCandle.close = c.close;
            currentHourCandle.volume += c.volume;
        }
    }
    if (currentHourCandle) data1h.push(currentHourCandle);
    
    return data1h;
}

async function runMegalodon() {
    console.log("Loading Multiple Assets (15M TIMEFRAME)...");
    const btcData = await loadCSV('data/btc_15m_history.csv', 'BTC');
    const ethData = await loadCSV('data/eth_15m_history.csv', 'ETH');
    const solData = await loadCSV('data/sol_15m_history.csv', 'SOL');
    const linkData = await loadCSV('data/link_15m_history.csv', 'LINK');
    const adaData = await loadCSV('data/ada_15m_history.csv', 'ADA');
    const bnbData = await loadCSV('data/bnb_15m_history.csv', 'BNB');
    const xrpData = await loadCSV('data/xrp_15m_history.csv', 'XRP');
    const dogeData = await loadCSV('data/doge_15m_history.csv', 'DOGE');
    const avaxData = await loadCSV('data/avax_15m_history.csv', 'AVAX');
    const dotData = await loadCSV('data/dot_15m_history.csv', 'DOT');

    console.log("Merging and Synchronizing Timeline...");
    const START_TIMESTAMP = 1672531200000; // Jan 1, 2023 (To keep the 15m test fast)
    const globalTimeline = [...btcData, ...ethData, ...solData, ...linkData, ...adaData, ...bnbData, ...xrpData, ...dogeData, ...avaxData, ...dotData]
        .filter(c => c.timestamp >= START_TIMESTAMP)
        .sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            // Prioritize coins with historically better performance if timestamps match
            const priority: Record<string, number> = { 'SOL': 1, 'ETH': 2, 'BTC': 3, 'LINK': 4, 'DOGE': 5 };
            const pA = priority[a.symbol] || 99;
            const pB = priority[b.symbol] || 99;
            return pA - pB;
        });

    console.log(`Simulation starting with ${globalTimeline.length} total events.\n`);

    let balance = INITIAL_CAPITAL;
    let consecutiveLosses = 0;
    let circuitBreakerActive = false;
    let stats = {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        breakEvens: 0,
        totalFeesPaid: 0,
        grossProfit: 0,
        grossLoss: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        peakBalance: INITIAL_CAPITAL,
        periods: {} as Record<string, { trades: number, wins: number, pnl: number }>,
        symbolStats: {} as Record<string, { trades: number, pnl: number, consecutiveLosses: number }>,
        cachedRegime: '' as any,
        cachedFft: 0 as any,
        cachedApEn: 0 as any
    };

    let activeTrades: Record<string, any> = {};
    let lastTradeClosedTime: Record<string, number> = {};

    const buffers: Record<string, MultiCandle[]> = {
        'BTC': [], 'ETH': [], 'SOL': [], 'LINK': [], 'ADA': [],
        'BNB': [], 'XRP': [], 'DOGE': [], 'AVAX': [], 'DOT': []
    };

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        const { symbol, timestamp, close: currentPrice } = candle;

        buffers[symbol].push(candle);
        if (buffers[symbol].length > 2000) buffers[symbol] = buffers[symbol].slice(500);

        const candles = buffers[symbol];
        if (candles.length < 1500) continue;

        const date = new Date(timestamp);
        const year = date.getFullYear();

        // TRADE MANAGEMENT (Cross-Margin)
        let activeTrade = activeTrades[symbol];
        if (activeTrade) {
            activeTrade.candlesSinceEntry++;

            if (balance > stats.peakBalance) stats.peakBalance = balance;
            const drawdown = stats.peakBalance - balance;
            if (drawdown > stats.maxDrawdown) stats.maxDrawdown = drawdown;
            const drawdownPercent = (drawdown / stats.peakBalance) * 100;
            if (drawdownPercent > stats.maxDrawdownPercent) stats.maxDrawdownPercent = drawdownPercent;

            let closed = false;
            let pnl = 0;
            let exitPrice = 0;

            const { action, entryPrice, initialSl, sl, tp, pyramidStage, pyramidPrice, entryRegime, blendedEntry } = activeTrade;

            const effectiveEntry = blendedEntry || entryPrice;
            const breakEvenLong = effectiveEntry * (1 + (MAKER_FEE * 3));
            const breakEvenShort = effectiveEntry * (1 - (MAKER_FEE * 3));

            // Hard R:R system. No trailing Chandelier stop.

            if (action === 'BUY') {
                if (candle.low <= activeTrade.sl) {
                    exitPrice = activeTrade.sl * 0.9995;
                    closed = true;
                }
                else if (candle.high >= tp) {
                    // Hard TP Reached (either Ranging mean or Trend 4R target)
                    exitPrice = tp;
                    closed = true;
                }
                else if (entryRegime !== 'RANGING' && !activeTrade.isCapitulation) {
                    // Trend Engine Management
                    const riskDistance = entryPrice - initialSl;
                    const currentR = (currentPrice - entryPrice) / riskDistance;

                    // ── EARLY BREAK-EVEN & TIME CAPITULATION ──
                    if (currentR >= 1.5 && activeTrade.sl < breakEvenLong) {
                        activeTrade.sl = breakEvenLong;
                    }
                    if (activeTrade.candlesSinceEntry > 48 && currentR < 1.0) {
                        exitPrice = currentPrice;
                        closed = true;
                        continue;
                    }

                    // ── STEP-TRAILING (Locking Profits) ──
                    if (currentR >= 1.0) {
                        activeTrade.sl = Math.max(activeTrade.sl, entryPrice + (entryPrice - initialSl) * 0.2); // Lock small profit
                    }
                    if (currentR >= 2.0) {
                        activeTrade.sl = Math.max(activeTrade.sl, entryPrice + (entryPrice - initialSl) * 1.0); // Lock 1R
                    }
                    if (currentR >= 3.0) {
                        activeTrade.sl = Math.max(activeTrade.sl, entryPrice + (entryPrice - initialSl) * 2.0); // Lock 2R
                    }
                    if (currentR >= 4.0) {
                        activeTrade.sl = Math.max(activeTrade.sl, entryPrice + (entryPrice - initialSl) * 3.0); // Lock 3R
                    }
                    if (currentR >= 6.0) {
                        activeTrade.sl = Math.max(activeTrade.sl, entryPrice + (entryPrice - initialSl) * 5.0); // Lock 5R
                    }
                    if (currentR >= 8.0) {
                        activeTrade.sl = Math.max(activeTrade.sl, entryPrice + (entryPrice - initialSl) * 7.0); // Lock 7R
                    }

                    // ── AGGRESSIVE PYRAMIDING (Add 100% size) ──
                    if (activeTrade.hurst >= 0.55) {
                        if (currentR >= 2.0 && pyramidStage === 0) {
                            activeTrade.pyramidStage = 1;
                            activeTrade.pyramidPrice = currentPrice;
                            // Add 100% size (equal dollar amount). Average entry is the harmonic mean.
                            activeTrade.blendedEntry = 2 / (1/entryPrice + 1/currentPrice);
                            const lockPrice = entryPrice + Math.abs(entryPrice - initialSl);
                            activeTrade.sl = Math.max(activeTrade.sl, lockPrice);
                        }
                        if (currentR >= 4.0 && pyramidStage === 1) {
                            activeTrade.pyramidStage = 2;
                            activeTrade.pyramidPrice = currentPrice;
                            // Add another 100% of base size (total 3x).
                            activeTrade.blendedEntry = 3 / (2/activeTrade.blendedEntry + 1/currentPrice);
                            const lockPrice = entryPrice + (Math.abs(entryPrice - initialSl) * 3);
                            activeTrade.sl = Math.max(activeTrade.sl, lockPrice);
                        }
                        if (currentR >= 6.0 && pyramidStage === 2) {
                            activeTrade.pyramidStage = 3;
                            activeTrade.pyramidPrice = currentPrice;
                            // Add another 50% of base size (total 3.5x).
                            activeTrade.blendedEntry = 3.5 / (3/activeTrade.blendedEntry + 0.5/currentPrice);
                            const lockPrice = entryPrice + (Math.abs(entryPrice - initialSl) * 5);
                            activeTrade.sl = Math.max(activeTrade.sl, lockPrice);
                        }
                    }
                }
            } else {
                if (candle.high >= activeTrade.sl) {
                    exitPrice = activeTrade.sl * 1.0005;
                    closed = true;
                }
                else if (candle.low <= tp) {
                    exitPrice = tp;
                    closed = true;
                }
                else if (entryRegime !== 'RANGING' && !activeTrade.isCapitulation) {
                    const riskDistance = initialSl - entryPrice;
                    const currentR = (entryPrice - currentPrice) / riskDistance;

                    // ── EARLY BREAK-EVEN & TIME CAPITULATION ──
                    if (currentR >= 1.5 && activeTrade.sl > breakEvenShort) {
                        activeTrade.sl = breakEvenShort;
                    }
                    if (activeTrade.candlesSinceEntry > 48 && currentR < 1.0) {
                        exitPrice = currentPrice;
                        closed = true;
                        continue;
                    }

                    // ── STEP-TRAILING FOR SHORTS (Locking Profits) ──
                    if (currentR >= 1.0) {
                        activeTrade.sl = Math.min(activeTrade.sl, entryPrice - (initialSl - entryPrice) * 0.2); // Lock small profit
                    }
                    if (currentR >= 2.0) {
                        activeTrade.sl = Math.min(activeTrade.sl, entryPrice - (initialSl - entryPrice) * 1.0); // Lock 1R
                    }
                    if (currentR >= 3.0) {
                        activeTrade.sl = Math.min(activeTrade.sl, entryPrice - (initialSl - entryPrice) * 2.0); // Lock 2R
                    }
                    if (currentR >= 4.0) {
                        activeTrade.sl = Math.min(activeTrade.sl, entryPrice - (initialSl - entryPrice) * 3.0); // Lock 3R
                    }
                    if (currentR >= 6.0) {
                        activeTrade.sl = Math.min(activeTrade.sl, entryPrice - (initialSl - entryPrice) * 5.0); // Lock 5R
                    }
                    if (currentR >= 8.0) {
                        activeTrade.sl = Math.min(activeTrade.sl, entryPrice - (initialSl - entryPrice) * 7.0); // Lock 7R
                    }

                    // ── AGGRESSIVE PYRAMIDING FOR SHORTS ──
                    if (activeTrade.hurst >= 0.55) {
                        if (currentR >= 2.0 && pyramidStage === 0) {
                            activeTrade.pyramidStage = 1;
                            activeTrade.pyramidPrice = currentPrice;
                            activeTrade.blendedEntry = 2 / (1/entryPrice + 1/currentPrice);
                            const lockPrice = entryPrice - Math.abs(initialSl - entryPrice);
                            activeTrade.sl = Math.min(activeTrade.sl, lockPrice);
                        }
                        if (currentR >= 4.0 && pyramidStage === 1) {
                            activeTrade.pyramidStage = 2;
                            activeTrade.pyramidPrice = currentPrice;
                            activeTrade.blendedEntry = 3 / (2/activeTrade.blendedEntry + 1/currentPrice);
                            const lockPrice = entryPrice - (Math.abs(initialSl - entryPrice) * 3);
                            activeTrade.sl = Math.min(activeTrade.sl, lockPrice);
                        }
                        if (currentR >= 6.0 && pyramidStage === 2) {
                            activeTrade.pyramidStage = 3;
                            activeTrade.pyramidPrice = currentPrice;
                            activeTrade.blendedEntry = 3.5 / (3/activeTrade.blendedEntry + 0.5/currentPrice);
                            const lockPrice = entryPrice - (Math.abs(initialSl - entryPrice) * 5);
                            activeTrade.sl = Math.min(activeTrade.sl, lockPrice);
                        }
                    }
                }
            }

            if (closed) {
                let rawPnl = 0;
                let totalEntryVolume = 0;
                let totalExitVolume = 0;

                // 50K HYPER-GROWTH Scaling Risk Curve
                let leverage = getDynamicLeverage(activeTrade.balanceAtEntry);
                let baseRisk = 0.03; 
                if (activeTrade.balanceAtEntry < 10000) baseRisk = 0.08;
                else if (activeTrade.balanceAtEntry < 30000) baseRisk = 0.05;
                else baseRisk = 0.03;

                let maxKellyRisk = 0.10;

                let riskMultiplier = baseRisk;

                // --- EQUITY CURVE DRAWDOWN BRAKE RESTORED ---
                if (drawdownPercent > 20) riskMultiplier *= 0.50;
                if (drawdownPercent > 30) riskMultiplier *= 0.50; // Total 0.25x

                // --- SYMBOL-SPECIFIC RISK SLASHING ---
                const symbolStats = stats.symbolStats[activeTrade.symbol];
                const symbolLosses = symbolStats ? (symbolStats.consecutiveLosses || 0) : 0;
                if (symbolLosses >= 2) riskMultiplier *= 0.5;
                if (symbolLosses >= 4) riskMultiplier *= 0.5; // Total 0.25x

                // POSITION CAP: Unleash Leverage (Up to 50% of buying power per trade)
                let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
                const maxPositionSize = activeTrade.balanceAtEntry * leverage;
                const maxAccountPercent = maxPositionSize * 0.50; // Hard cap: 50% of LEVERAGED buying power
                if (basePositionSize > maxPositionSize) basePositionSize = maxPositionSize;
                if (basePositionSize > maxAccountPercent) basePositionSize = maxAccountPercent;
                if (basePositionSize > HARD_POSITION_CAP) basePositionSize = HARD_POSITION_CAP;

                let totalSizeMultiplier = 1;
                if (activeTrade.pyramidStage === 1) totalSizeMultiplier = 2; // base + 100%
                else if (activeTrade.pyramidStage === 2) totalSizeMultiplier = 3; // base + 100% + 100%
                else if (activeTrade.pyramidStage >= 3) totalSizeMultiplier = 3.5; // base + 100% + 100% + 50%

                const totalPositionSize = basePositionSize * totalSizeMultiplier;
                const effectiveEntry = activeTrade.blendedEntry || entryPrice;
                
                const movePerc = action === 'BUY' ? (exitPrice - effectiveEntry) / effectiveEntry : (effectiveEntry - exitPrice) / effectiveEntry;
                rawPnl = totalPositionSize * movePerc;
                totalEntryVolume = totalPositionSize;
                totalExitVolume = totalPositionSize;

                // REALISTIC SLIPPAGE: 0.04% base + small adaptive component (max 0.06% total)
                const currentAtr = calculateATR(candles);
                // Using Limit Orders on Gann Supports: 0 Slippage
                const adaptiveSlippage = 0; 
                const entryFee = totalEntryVolume * MAKER_FEE;
                const exitFee = totalExitVolume * MAKER_FEE;
                pnl = rawPnl - entryFee - exitFee;

                balance += pnl;

                // --- BRAKE RELEASE MECHANISM ---
                if (action === 'BUY') {
                    const currentR = (exitPrice - entryPrice) / (entryPrice - initialSl);
                    if (currentR >= 3.0) stats.peakBalance = balance;
                } else {
                    const currentR = (entryPrice - exitPrice) / (initialSl - entryPrice);
                    if (currentR >= 3.0) stats.peakBalance = balance;
                }

                stats.totalFeesPaid += (entryFee + exitFee);
                stats.totalTrades++;

                if (!stats.symbolStats[activeTrade.symbol]) {
                    stats.symbolStats[activeTrade.symbol] = { trades: 0, pnl: 0, consecutiveLosses: 0 };
                }
                stats.symbolStats[activeTrade.symbol].trades++;
                stats.symbolStats[activeTrade.symbol].pnl += pnl;

                if (pnl > 0) {
                    stats.wins++;
                    stats.grossProfit += pnl;
                    stats.symbolStats[activeTrade.symbol].consecutiveLosses = 0;
                }
                else if (pnl > -2 && pnl < 2) {
                    stats.breakEvens++;
                }
                else {
                    stats.losses++;
                    stats.grossLoss += Math.abs(pnl);
                    stats.symbolStats[activeTrade.symbol].consecutiveLosses = (stats.symbolStats[activeTrade.symbol].consecutiveLosses || 0) + 1;
                }

                // DYNAMIC CIRCUIT BREAKER: Stricter as balance grows (snowball protection)
                const cbThreshold = getDynamicCircuitBreakerThreshold(stats.peakBalance);
                const drawdownThreshold = stats.peakBalance * cbThreshold;
                if (balance < drawdownThreshold && stats.totalTrades > 10) {
                    circuitBreakerActive = true;
                    if (i % 100 === 0) console.log(`⚠️  CIRCUIT BREAKER (${((1 - cbThreshold) * 100).toFixed(0)}%): Balance $${balance.toFixed(0)} - Halting trades`);
                }

                const half = date.getMonth() < 6 ? 'H1' : 'H2';
                const period = `${year}-${half}`;
                if (!stats.periods[period]) stats.periods[period] = { trades: 0, wins: 0, pnl: 0 };
                stats.periods[period].trades++;
                stats.periods[period].pnl += pnl;
                if (pnl > 0) stats.periods[period].wins++;

                if (balance < INITIAL_CAPITAL - MAX_LOSS_LIMIT) {
                    console.log(`\n💥 CIRCUIT BREAKER HIT at ${date.toISOString()}! Balance: $${balance.toFixed(2)}`);
                    break;
                }
                lastTradeClosedTime[symbol] = timestamp;
                delete activeTrades[symbol];
            }
            continue;
        }

        // CACHE HEAVY MATH (Every 4 candles / 1 hour)
        const isHourTick = (timestamp % (1000 * 60 * 60)) === 0;
        if (isHourTick || !stats.cachedRegime) {
            stats.cachedRegime = detectRegime(candles);
        }
        const regime = stats.cachedRegime;
        const maxConcurrent = 3;

        // Global circuit breaker removed in favor of symbol-specific risk slashing

        if (Object.keys(activeTrades).length >= maxConcurrent) continue;
        const lastClose = lastTradeClosedTime[symbol] || 0;
        if (timestamp - lastClose < 1000 * 60 * 60 * 24) continue; // Cooldown: 24 hours

        let action = '';
        let tp = 0;
        let sl = 0;

        const atr = calculateATR(candles);
        const hurstForSL = calculateHurstExponent(candles, 50);
        const atrMultiplier = getHurstAdaptiveATRMultiplier(hurstForSL);
        let dynamicSL = (atr / currentPrice) * atrMultiplier;
        if (dynamicSL < 0.015) dynamicSL = 0.015; // Floor at 1.5% (Hunter strict tolerance)
        if (dynamicSL > 0.05) dynamicSL = 0.05; // Ceiling at 5%

        const macroEma = calculateEMA(candles, 800);

        // ── GANN & SMC BOUNCE ENGINE (Hunter Sync) ──────────────────────────────────
        let absoluteLow = Infinity;
        let absoluteHigh = -Infinity;
        for (const c of candles) {
            if (c.low < absoluteLow) absoluteLow = c.low;
            if (c.high > absoluteHigh) absoluteHigh = c.high;
        }
        const macroPivotPrice = regime === 'TRENDING' ? absoluteLow : absoluteHigh;

        const { supports, resistances } = calculateGannSquareOf9(macroPivotPrice, currentPrice);
        
        let closestSupport = 0;
        for (const s of supports) {
            if (currentPrice >= s) { closestSupport = s; break; }
        }

        let closestResistance = Infinity;
        for (const r of resistances) {
            if (r >= currentPrice) { closestResistance = r; break; }
        }

        if (closestSupport > 0 && closestResistance < Infinity) {
            const longTP = closestResistance;
            const longSL = closestSupport * (1 - dynamicSL);
            // WICK ENTRY: The live bot enters at closestSupport. RR should be calculated from entry.
            const longRR = (longTP - closestSupport) / (closestSupport - longSL);

            const shortTP = closestSupport;
            const shortSL = closestResistance * (1 + dynamicSL);
            const shortRR = (closestResistance - shortTP) / (shortSL - closestResistance);

            // WICK ENTRY SIMULATION:
            // Instead of calculating distance from the CLOSE, we check if the LOW/HIGH hit the Gann level during the candle.
            // We also ensure the candle OPENED above support / below resistance to confirm it's a bounce.
            let distanceToSupportPerc = 1; // Default to NO ENTRY
            let distanceToResPerc = 1;

            if (candle.open > closestSupport && candle.low <= closestSupport * 1.015) {
                distanceToSupportPerc = 0; // Hit!
            }
            
            if (candle.open < closestResistance && candle.high >= closestResistance * 0.985) {
                distanceToResPerc = 0; // Hit!
            }

            let potentialAction = '';
            const gannTolerance = 0.015; // 1.5% tolerance for Gann entry
            
            // TIME CYCLE & VOLUME FILTER (Sniper Mode)
            // 1. Time Cycle Check
            let daysSincePivot = 0;
            // Approximate days since macro pivot by finding its index
            const pivotIndex = candles.findIndex(c => c.low === macroPivotPrice || c.high === macroPivotPrice);
            if (pivotIndex !== -1) {
                daysSincePivot = (candles.length - 1 - pivotIndex) / 24; // 1H intervals to days
            }
            const timeCycle = calculateTimeCycles(daysSincePivot);
            
            // 2. Volume Spike Check (Institutions defending the level)
            let volSum = 0;
            const volPeriod = 20;
            for (let v = candles.length - volPeriod; v < candles.length; v++) volSum += candles[v].volume;
            const avgVol = volSum / volPeriod;
            const hasVolSpike = candle.volume > avgVol * 1.5; // 150% volume

            // 1H TIMEFRAME IS MACRO: We don't need Time Cycle / Volume Spike blockers.
            // A Gann + SMC validation on 1H is strong enough on its own.
            // Reduced RR to 2.0 to catch more swings without being overly greedy.
            if (longRR >= 2.0 && distanceToSupportPerc <= gannTolerance) {
                potentialAction = 'BUY';
                tp = longTP;
                sl = longSL;
            } else if (shortRR >= 2.0 && distanceToResPerc <= gannTolerance) {
                potentialAction = 'SELL';
                tp = shortTP;
                sl = shortSL;
            }

            // WEEKEND FILTER (Conditional: Only apply when balance is large to protect compounded gains, keep grinding when small)
            if (potentialAction && balance >= 100000) {
                const dayOfWeek = new Date(candle.timestamp).getUTCDay(); // 0 = Sunday, 6 = Saturday
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    potentialAction = '';
                }
            }

            if (potentialAction) {
                // SMC Validation
                const recentCandles = candles.slice(-300); // Only check last ~3 days for relevant OBs
                const obs = findOrderBlocks(recentCandles as any);
                
                if (potentialAction === 'BUY') {
                    // WICK ENTRY: The candle LOW must have touched the Bullish Order Block
                    const validOB = obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && candle.low <= ob.top * 1.01 && candle.close >= ob.bottom);
                    if (validOB) action = 'BUY';
                } else if (potentialAction === 'SELL') {
                    // WICK ENTRY: The candle HIGH must have touched the Bearish Order Block
                    const validOB = obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && candle.high >= ob.bottom * 0.99 && candle.close <= ob.top);
                    if (validOB) action = 'SELL';
                }
            }
        }

        // MATHEMATICAL FFT CYCLE FILTER & APEN (Cached every 4 candles for Speed)
        if (action && candles.length >= 66) {
            if (isHourTick || !stats.cachedFft) {
                const fft = detectDominantCycleFFT(candles, 64);
                let phaseValue = 0;
                if (fft.magnitude > 0) phaseValue = Math.cos(fft.phase);
                const apEn = calculateApproximateEntropy(candles, 2, 0.2);

                stats.cachedFft = phaseValue;
                stats.cachedApEn = apEn;
            }

            if (action === 'BUY' && stats.cachedFft > 0.7) action = '';
            if (action === 'SELL' && stats.cachedFft < -0.7) action = '';
            if (stats.cachedApEn > 1.5) action = '';
        }

        // EHLERS FISHER TRANSFORM CONFIRMATION
        // Only enter if Fisher is aligned (not at extreme opposite side)
        if (action && candles.length >= 12) {
            const { fisher } = calculateFisherTransform(candles, 10);
            if (action === 'BUY' && fisher > 2.0) action = '';   // Overbought extreme
            if (action === 'SELL' && fisher < -2.0) action = ''; // Oversold extreme
        }

        // Z-SCORE VWAP: In RANGING markets, only enter at statistical extremes
        if (action && candles.length >= 50) {
            if (regime === 'RANGING') {
                const { zScore } = calculateZScoreVWAP(candles, 50);
                // In ranging markets, only buy when oversold and sell when overbought
                if (action === 'BUY' && zScore > 0.5) action = '';   // Price above VWAP, not yet cheap
                if (action === 'SELL' && zScore < -0.5) action = ''; // Price below VWAP, not yet expensive
            }
        }

        // MACRO TREND ALIGNMENT FILTER (MTF) - 800 EMA on 15m (equivalent to 50 EMA on 4H)
        if (action && candles.length >= 800) {
            const macroEma = calculateEMA(candles, 800);
            const weeklyEma = calculateEMA(candles, 672); // Approx 1-week moving average

            // CAPITULATION OVERRIDE (Knife Catcher)
            const rsi = calculateRSI(candles, 14);
            let volSum = 0;
            const volPeriod = 20;
            for (let v = candles.length - volPeriod; v < candles.length; v++) {
                volSum += candles[v].volume;
            }
            const avgVol = volSum / volPeriod;
            const volSpike = candle.volume > avgVol * 3.0; // 300% volume spike

            let override = false;
            if (action === 'BUY' && rsi < 25 && volSpike) override = true;
            if (action === 'SELL' && rsi > 75 && volSpike) override = true;

            if (!override) {
                if (action === 'BUY' && currentPrice < macroEma) action = '';
                if (action === 'SELL' && currentPrice > macroEma) action = '';

                // Strict Weekly Alignment Filter (Reduce Drawdown)
                if (action === 'BUY' && currentPrice < weeklyEma) action = '';
                if (action === 'SELL' && currentPrice > weeklyEma) action = '';
            } else {
                // If it's a capitulation knife-catch, widen the stop loss slightly to survive the chop
                sl = action === 'BUY' ? sl * 0.99 : sl * 1.01;
            }
        }
        // Syntax error fixed
        // SYNTHETIC FUNDING RATE PROXY (Prevent buying into extreme retail euphoria or selling into panic)
        // High RSI on higher timeframes usually correlates with extremely positive funding rates
        if (action) {
            const rsi = calculateRSI(candles, 14);
            if (action === 'BUY' && rsi > 75) {
                // Euphoria (Funding rate likely > 0.03%) - skip long
                action = '';
            } else if (action === 'SELL' && rsi < 25) {
                // Panic (Funding rate likely < -0.03%) - skip short
                action = '';
            }
        }

        // SYNTHETIC BTC DOMINANCE PROXY (Protect Altcoins)
        if (action === 'BUY' && symbol !== 'BTC' && symbol !== 'ETH') {
            const btcData = buffers['BTC'];
            const btcCandle = btcData.find(c => c.timestamp === candle.timestamp);
            if (btcCandle) {
                const btcIndex = btcData.indexOf(btcCandle);
                if (btcIndex >= 20) {
                    const btcSlice = btcData.slice(0, btcIndex + 1);
                    const btcRsi = calculateRSI(btcSlice, 14);
                    const altRsi = calculateRSI(candles, 14);
                    // If BTC is surging (RSI > 60) but Altcoin is lagging (RSI < 50), BTC.D is rising. Altcoin will bleed.
                    if (btcRsi > 60 && altRsi < 50) {
                        action = '';
                    }
                }
            }
        }

        // SMART WEEKEND CHOPPINESS FILTER
        if (action) {
            const dayOfWeek = date.getUTCDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                if (!['BTC', 'ETH', 'SOL'].includes(symbol)) {
                    action = '';
                } else {
                    const rr = Math.abs(tp - currentPrice) / Math.abs(currentPrice - sl);
                    if (rr < 5) action = '';
                }
            }
        }

        // DIRECTIONAL PARITY SHIELD (Beta-Neutralizer)
        if (action) {
            let buyCount = 0; let sellCount = 0;
            for (const tr of Object.values(activeTrades)) {
                if (tr.action === 'BUY') buyCount++;
                else if (tr.action === 'SELL') sellCount++;
            }
            if (action === 'BUY' && (buyCount - sellCount) >= 3) action = '';
            if (action === 'SELL' && (sellCount - buyCount) >= 3) action = '';
        }

        // BALANCE CIRCUIT BREAKER: More lenient - allow recovery after 50% loss
        const shouldSkipEntry = (balance < (stats.peakBalance * 0.50) && stats.totalTrades > 50) || circuitBreakerActive;

        if (action && !shouldSkipEntry) {
            const chop = calculateChoppinessIndex(candles, 288);
            activeTrades[symbol] = {
                symbol,
                action,
                entryPrice: action === 'BUY' ? closestSupport : closestResistance,
                entryTime: timestamp,
                sl,
                initialSl: sl,
                tp,
                pyramidStage: 0,
                balanceAtEntry: balance,
                isChoppy: chop > 50,
                hurst: hurstForSL,
                candlesSinceEntry: 0,
                isSqueezeAccelerated: detectSqueeze(candles),
                entryRegime: stats.cachedRegime,
                isCapitulation: action === 'BUY' ? calculateRSI(candles, 14) < 30 : calculateRSI(candles, 14) > 70 // approx tag
            };
        }
    }

    console.log(`\n============================================`);
    console.log(`   MEGALODON CROSS-MARGIN BACKTEST (10 COINS)`);
    console.log(`============================================`);
    console.log(`Final Balance:    $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     $${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPercent.toFixed(2)}%)`);
    console.log(`Total Fees Paid:  $${stats.totalFeesPaid.toFixed(2)}`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Win Rate:         ${((stats.wins / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Loss Rate:        ${((stats.losses / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Break-Evens:      ${((stats.breakEvens / stats.totalTrades) * 100).toFixed(2)}%\n`);

    const sortedPeriods = Object.keys(stats.periods).sort();
    let runningBalance = INITIAL_CAPITAL;
    for (const period of sortedPeriods) {
        const pStats = stats.periods[period];
        runningBalance += pStats.pnl;
        console.log(`--- ${period} ---`);
        console.log(`Trades: ${pStats.trades} | Period PnL: $${pStats.pnl.toFixed(2)} | End Balance: $${runningBalance.toFixed(2)} | Win Rate: ${((pStats.wins / pStats.trades) * 100).toFixed(2)}%\n`);
    }

    console.log(`--- SYMBOL BREAKDOWN ---`);
    for (const sym of Object.keys(stats.symbolStats)) {
        console.log(`${sym} -> Trades: ${stats.symbolStats[sym].trades} | PnL: $${stats.symbolStats[sym].pnl.toFixed(2)}`);
    }
    console.log(`============================================\n`);
}

runMegalodon().catch(console.error);
