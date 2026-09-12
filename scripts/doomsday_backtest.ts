import * as fs from 'fs';
import * as readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';
import { detectSqueeze, calculateChoppinessIndex, detectLiquiditySweep, calculateRollingVWAP, calculateVolumeProfile, synthesizeDailyCandles, detectDailyTrend, detectCandlePattern, detectCapitulation, checkEarlyExit, detectRegime } from '../src/lib/trading/financial-intelligence';

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
const MAKER_FEE = 0.0004; // Taker fee + Slippage simulation
const HARD_POSITION_CAP = 50000; // Realistic orderbook liquidity limit for altcoins

function calculateATR(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < 2) return 0;
    const actualPeriod = Math.min(period, candles.length - 1);
    let trSum = 0;
    for (let i = candles.length - actualPeriod; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
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
    
    for (let i = candles.length - period; i < candles.length; i++) {
        const change = candles[i].close - candles[i-1].close;
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

async function runMegalodon() {
    console.log("Loading Multiple Assets...");
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
    const START_TIMESTAMP = 1514764800000; // Jan 1, 2018 (6-year backtest)
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
        symbolStats: {} as Record<string, { trades: number, pnl: number }>
    };
    
    let activeTrades: Record<string, any> = {};
    let lastTradeClosedTime: Record<string, number> = {};
    let vaultBalance = 0;
    let consecutiveLosses = 0;
    let circuitBreakerActive = false;
    
    const buffers: Record<string, MultiCandle[]> = {
        'BTC': [], 'ETH': [], 'SOL': [], 'LINK': [], 'ADA': [],
        'BNB': [], 'XRP': [], 'DOGE': [], 'AVAX': [], 'DOT': []
    };
    
    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        const { symbol, timestamp, open, high, low, close: currentPrice, volume } = candle;
        
        buffers[symbol].push(candle);
        if (buffers[symbol].length > 1500) buffers[symbol].shift();
        
        const candles = buffers[symbol];
        if (candles.length < 1500) continue;
        
        // Vault Harvesting DISABLED FOR TEST
        // if (balance >= INITIAL_CAPITAL * 2) {
        //     vaultBalance += INITIAL_CAPITAL;
        //     balance -= INITIAL_CAPITAL;
        //     console.log(`[VAULT HARVEST] Doubled! Stashed $${INITIAL_CAPITAL} in Vault. Total Vault: $${vaultBalance} | Active Balance: $${balance}`);
        // }
        
        // Auto-Recharge DISABLED FOR TEST
        // if (balance < 100) {
        //     if (vaultBalance >= INITIAL_CAPITAL) {
        //         vaultBalance -= INITIAL_CAPITAL;
        //         balance += INITIAL_CAPITAL;
        //         console.log(`[DOOMSDAY RECHARGE] Account nearly wiped. Recharged $${INITIAL_CAPITAL} from Vault. Remaining Vault: $${vaultBalance} | Active Balance: $${balance}`);
        //     }
        // }
        
        // TRADE MANAGEMENT (Cross-Margin)
        let activeTrade = activeTrades[symbol];
        if (activeTrade) {
            
            if (balance > stats.peakBalance) stats.peakBalance = balance;
            const drawdown = stats.peakBalance - balance;
            if (drawdown > stats.maxDrawdown) stats.maxDrawdown = drawdown;
            const drawdownPercent = (drawdown / stats.peakBalance) * 100;
            if (drawdownPercent > stats.maxDrawdownPercent) stats.maxDrawdownPercent = drawdownPercent;
            
            let closed = false;
            let pnl = 0;
            let exitPrice = 0;
            
            const { entryPrice, tp, action, pyramidStage, initialSl, entryTime } = activeTrade;
            const atr = calculateATR(candles, 14);
            const chandelierLong = currentPrice - (atr * 2);
            const chandelierShort = currentPrice + (atr * 2);
            
            if (action === 'BUY') {
                const isEarlyExit = checkEarlyExit(activeTrade, candles);
                if (isEarlyExit) {
                   exitPrice = currentPrice;
                   closed = true;
                }
                else if (candle.low <= activeTrade.sl) {
                  exitPrice = activeTrade.sl * 0.999;
                  closed = true;
                }
                else if (pyramidStage === 0 && candle.high >= tp) {
                  activeTrade.pyramidStage = 1;
                }
                
                if (pyramidStage > 0) {
                  activeTrade.sl = Math.max(activeTrade.sl, chandelierLong); 
                  if (candle.low <= activeTrade.sl) { exitPrice = activeTrade.sl; closed = true; }
                }
            } else {
                const isEarlyExit = checkEarlyExit(activeTrade, candles);
                if (isEarlyExit) {
                   exitPrice = currentPrice;
                   closed = true;
                }
                else if (candle.high >= activeTrade.sl) {
                  exitPrice = activeTrade.sl * 1.001; 
                  closed = true;
                }
                else if (pyramidStage === 0 && candle.low <= tp) {
                  activeTrade.pyramidStage = 1;
                }
                
                if (pyramidStage > 0) {
                  activeTrade.sl = Math.min(activeTrade.sl, chandelierShort);
                  if (candle.high >= activeTrade.sl) { exitPrice = activeTrade.sl; closed = true; }
                }
            }
            
            if (closed) {
                let rawPnl = 0;
                let totalEntryVolume = 0;
                let totalExitVolume = 0;
                
                // Production-equivalent: Balance-tiered leverage & risk
                let baseRisk = 0.005;
                let maxKellyRisk = 0.01; // Max 1% risk per trade
                let leverage = 10;
                
                if (activeTrade.balanceAtEntry >= 100000) {
                    baseRisk = 0.002;
                    maxKellyRisk = 0.005;
                    leverage = 3;
                } else if (activeTrade.balanceAtEntry >= 20000) {
                    baseRisk = 0.003;
                    maxKellyRisk = 0.008;
                    leverage = 5;
                }
                
                let riskMultiplier = baseRisk; 
                
                if (stats.totalTrades > 50) {
                   const W = stats.wins / stats.totalTrades;
                   const avgWin = stats.wins > 0 ? (stats.grossProfit / stats.wins) : 10;
                   const avgLoss = stats.losses > 0 ? (stats.grossLoss / stats.losses) : 1;
                   let R = avgWin / (avgLoss || 1);
                   if (R < 1) R = 1;
                   const kelly = W - ((1 - W) / R);
                   if (kelly > 0) {
                       const optimalRisk = Math.max(baseRisk, Math.min(maxKellyRisk, kelly * 0.25));
                       riskMultiplier = optimalRisk;
                   }
                }
                
                if (activeTrade.isSqueezeAccelerated) riskMultiplier *= 1.5; 
                else if (activeTrade.isChoppy) riskMultiplier *= 0.5;
                
                // --- EQUITY CURVE DRAWDOWN BRAKE ---
                if (drawdownPercent > 25) {
                    riskMultiplier *= 0.25; // Survival Mode
                } else if (drawdownPercent > 15) {
                    riskMultiplier *= 0.50; // Warning Mode
                }
                
                let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
                const maxPositionSize = activeTrade.balanceAtEntry * leverage; 
                if (basePositionSize > maxPositionSize) basePositionSize = maxPositionSize;
                if (basePositionSize > HARD_POSITION_CAP) basePositionSize = HARD_POSITION_CAP;
                
                if (activeTrade.pyramidStage === 0) {
                   const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
                   rawPnl = basePositionSize * movePerc;
                   totalEntryVolume = basePositionSize;
                   rawPnl = basePositionSize * movePerc;
                   totalEntryVolume = basePositionSize;
                   totalExitVolume = basePositionSize;
                } else {
                   const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
                   rawPnl = (basePositionSize * 2) * movePerc;
                   totalEntryVolume = basePositionSize * 2;
                   totalExitVolume = basePositionSize * 2;
                }
                
                // FLASH CRASH GAP SLIPPAGE
                if (action === 'BUY' && candle.low < activeTrade.sl * 0.98) {
                   exitPrice = activeTrade.sl * 0.985;
                   rawPnl -= basePositionSize * 0.015; // Extra 1.5% slippage loss
                }
                if (action === 'SELL' && candle.high > activeTrade.sl * 1.02) {
                   exitPrice = activeTrade.sl * 1.015;
                   rawPnl -= basePositionSize * 0.015; // Extra 1.5% slippage loss
                }
                
                const entryFee = totalEntryVolume * 0.0012; 
                const exitFee = totalExitVolume * 0.0012; 
                
                // FUNDING RATE BLEED
                const holdingCandles = (timestamp - activeTrade.entryTime) / (1000 * 60 * 15);
                const fundingPeriods = Math.floor(holdingCandles / 32); // Every 8 hours
                const fundingFee = fundingPeriods * (totalEntryVolume * 0.0001); // 0.01% fee
                
                pnl = rawPnl - entryFee - exitFee - fundingFee;
                
                balance += pnl;
                stats.totalFeesPaid += (entryFee + exitFee);
                stats.totalTrades++;
                
                if (!stats.symbolStats[activeTrade.symbol]) stats.symbolStats[activeTrade.symbol] = { trades: 0, pnl: 0 };
                stats.symbolStats[activeTrade.symbol].trades++;
                stats.symbolStats[activeTrade.symbol].pnl += pnl;
                
                if (rawPnl > 0) {
                    stats.wins++;
                    stats.grossProfit += rawPnl;
                    consecutiveLosses = 0; // Reset circuit breaker on win
                } else if (rawPnl < 0) {
                    stats.losses++;
                    stats.grossLoss += Math.abs(rawPnl);
                    consecutiveLosses++;
                    
                    // Activate Circuit Breaker on 3 consecutive losses
                    if (consecutiveLosses >= 3) {
                        circuitBreakerActive = true;
                    }
                }
                
                const date = new Date(timestamp);
                const year = date.getFullYear();
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
        
        // TRIGGER LOGIC
        const regime = detectRegime(candles);
        const maxConcurrent = regime === 'TRENDING' ? 8 : 3;
        if (Object.keys(activeTrades).length >= maxConcurrent) continue;
        
        // BETA-NEUTRALIZER
        let buyCount = 0; let sellCount = 0;
        for (const tr of Object.values(activeTrades)) {
            if (tr.action === 'BUY') buyCount++;
            else sellCount++;
        }
        
        // Enforce Smart Circuit Breaker and Time Spacing
        if (circuitBreakerActive) {
            const chop = calculateChoppinessIndex(candles, 288);
            if (chop < 50) {
                circuitBreakerActive = false;
                consecutiveLosses = 0;
            } else {
                continue;
            }
        }
        
        const lastClose = lastTradeClosedTime[symbol] || 0;
        if (timestamp - lastClose < 1000 * 60 * 15) continue; // Cooldown
        
        const gann = calculateGannSquareOf9(currentPrice);
        const supports = gann.supports.sort((a, b) => b - a);
        const resistances = gann.resistances.sort((a, b) => a - b);
        if (supports.length === 0 || resistances.length === 0) continue;
        
        const closestSupport = supports[0];
        const closestResistance = resistances[0];
        const distanceToSupportPerc = (currentPrice - closestSupport) / currentPrice;
        const distanceToResPerc = (closestResistance - currentPrice) / currentPrice;
        
        let action = '';
        let tp = 0;
        let sl = 0;
        
        const atr = calculateATR(candles);
        let dynamicSL = (atr / currentPrice) * 1.5; 
        if (dynamicSL < 0.003) dynamicSL = 0.003; 
        
        const capitulation = await detectCapitulation(candles, symbol, 200);
        if (capitulation === 'BULLISH') {
            action = 'BUY'; 
            sl = currentPrice * (1 - dynamicSL); 
            tp = currentPrice * (1 + (dynamicSL * 5)); 
        } 
        else if (capitulation === 'BEARISH') {
            action = 'SELL';
            sl = currentPrice * (1 + dynamicSL);
            tp = currentPrice * (1 - (dynamicSL * 5));
        }
        
        if (!action) {
            const regime = detectRegime(candles);
            
            if (regime === 'RANGING') {
                if (distanceToSupportPerc <= dynamicSL) {
                    const validTP = resistances.find(r => r > currentPrice);
                    if (validTP && (validTP - currentPrice) / (currentPrice - closestSupport * (1 - dynamicSL)) >= 1.0) { action = 'BUY'; tp = validTP; sl = closestSupport * (1 - dynamicSL); }
                } 
                else if (distanceToResPerc <= dynamicSL) {
                    const validTP = supports.find(s => s < currentPrice);
                    if (validTP && (currentPrice - validTP) / (closestResistance * (1 + dynamicSL) - currentPrice) >= 1.0) { action = 'SELL'; tp = validTP; sl = closestResistance * (1 + dynamicSL); }
                }
            } else {
                if (distanceToSupportPerc <= dynamicSL) {
                    const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - closestSupport * (1 - dynamicSL)) >= 1.5);
                    if (validTP) { action = 'BUY'; tp = validTP; sl = closestSupport * (1 - dynamicSL); }
                } 
                else if (distanceToResPerc <= dynamicSL) {
                    const validTP = supports.find(s => (currentPrice - s) / (closestResistance * (1 + dynamicSL) - currentPrice) >= 1.5);
                    if (validTP) { action = 'SELL'; tp = validTP; sl = closestResistance * (1 + dynamicSL); }
                }
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
            for(let v = candles.length - volPeriod; v < candles.length; v++) {
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
        
        if (action) {
            if (action === 'BUY' && buyCount >= 2) action = '';
            if (action === 'SELL' && sellCount >= 2) action = '';
        }
        
        if (action) {
            const chop = calculateChoppinessIndex(candles, 288);
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
                isChoppy: chop > 50,
                isSqueezeAccelerated: detectSqueeze(candles)
            };
        }
    }
    
    console.log(`\n============================================`);
    console.log(`   MEGALODON CROSS-MARGIN BACKTEST (10 COINS)`);
    console.log(`============================================`);
    console.log(`Final Active Bal: $${balance.toFixed(2)}`);
    console.log(`Vault Balance:    $${vaultBalance.toFixed(2)} (Harvested safely!)`);
    console.log(`Total Value:      $${(balance + vaultBalance).toFixed(2)}`);
    console.log(`Net Profit:       $${((balance + vaultBalance) - INITIAL_CAPITAL).toFixed(2)}`);
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
