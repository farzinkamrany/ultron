/**
 * MEGALODON WITH DYNAMIC LEVERAGE SCALING
 * Aggressive early (20x when $1K), protective late (2x when $1M)
 * 
 * Strategy: Snowball Effect
 * - Year 1-2: MAX leverage 20x (capital at risk = low)
 * - Year 3-4: Medium leverage 10x (growing capital)
 * - Year 5+: Conservative leverage 2-3x (preserve gains)
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { detectSqueeze, calculateChoppinessIndex, detectCapitulationSync, checkEarlyExit, detectRegime, detectDominantCycleFFT, calculateFisherTransform, calculateApproximateEntropy, calculateZScoreVWAP, calculateHurstExponent, getHurstAdaptiveATRMultiplier } from '../src/lib/trading/financial-intelligence';

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
const MAKER_FEE = 0.0004;
const HARD_POSITION_CAP = 500000;

// DYNAMIC LEVERAGE FUNCTION: Scales from 20x (at $1K) to 2x (at $1M)
function getDynamicLeverage(balance: number): number {
  // At $1K: 20x leverage
  // At $50K: 10x leverage
  // At $250K: 3x leverage
  // At $1M: 2x leverage
  
  if (balance < 5000) return 20;        // Very early = aggressive
  if (balance < 25000) return 15;       // Early = aggressive
  if (balance < 50000) return 10;       // Growing = moderate
  if (balance < 250000) return 5;       // Matured = conservative
  return 2;                              // Wealthy = very conservative
}

// DYNAMIC RISK PER TRADE: Scales based on balance growth
function getDynamicRiskPercentage(balance: number): number {
  if (balance < 5000) return 0.05;      // 5% risk when small
  if (balance < 25000) return 0.04;     // 4% risk
  if (balance < 50000) return 0.03;     // 3% risk
  if (balance < 250000) return 0.02;    // 2% risk
  return 0.015;                         // 1.5% risk when large
}

// DYNAMIC CIRCUIT BREAKER: Relaxed when small, strict when large
function getDynamicCircuitBreakerThreshold(peakBalance: number): number {
  if (peakBalance < 5000) return 0.20;   // Allow -80% drawdown when $1K (recovery from $200)
  if (peakBalance < 25000) return 0.40;  // Allow -60% drawdown when $25K
  if (peakBalance < 50000) return 0.60;  // Allow -40% drawdown when $50K
  if (peakBalance < 250000) return 0.70; // Allow -30% drawdown when $250K
  return 0.80;                           // Allow -20% drawdown when $1M (PROTECT GAINS)
}

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

async function runSnowballBacktest() {
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
    const START_TIMESTAMP = 1514764800000; // Jan 1, 2018
    const globalTimeline = [...btcData, ...ethData, ...solData, ...linkData, ...adaData, ...bnbData, ...xrpData, ...dogeData, ...avaxData, ...dotData]
    .filter(c => c.timestamp >= START_TIMESTAMP)
    .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
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
        leverageHistory: [] as Array<{time: number, leverage: number, balance: number}>,
        periods: {} as Record<string, { trades: number, wins: number, pnl: number }>,
        symbolStats: {} as Record<string, { trades: number, pnl: number }>,
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
        
        // Get dynamic leverage for this balance
        const currentLeverage = getDynamicLeverage(balance);
        const currentRiskPct = getDynamicRiskPercentage(balance);
        const cbThreshold = getDynamicCircuitBreakerThreshold(stats.peakBalance);
        
        // Log leverage changes
        if (stats.leverageHistory.length === 0 || stats.leverageHistory[stats.leverageHistory.length - 1].leverage !== currentLeverage) {
            stats.leverageHistory.push({ time: timestamp, leverage: currentLeverage, balance });
        }
        
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
            
            const { action, entryPrice, initialSl, sl, tp, pyramidStage, pyramidPrice } = activeTrade;
            const atr = calculateATR(candles, 14);
            const trailingAtrMult = activeTrade.pyramidStage > 0 ? 1.5 : 2;
            const chandelierLong = currentPrice - (atr * trailingAtrMult);
            const chandelierShort = currentPrice + (atr * trailingAtrMult);
            
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
                  const macroEma = calculateEMA(candles, 200);
                  let volSum = 0;
                  const volPeriod = Math.min(20, candles.length);
                  for(let v = candles.length - volPeriod; v < candles.length; v++) {
                      volSum += candles[v].volume;
                  }
                  const avgVol = volSum / volPeriod;

                  if (currentPrice > macroEma && candle.volume > avgVol * 1.5) {
                      activeTrade.pyramidStage = 1;
                      activeTrade.pyramidPrice = tp;
                      activeTrade.sl = Math.max(activeTrade.sl, entryPrice);
                  }
                }
                
                if (pyramidStage > 0) {
                  activeTrade.sl = Math.max(activeTrade.sl, chandelierLong);
                }
                
                if (candle.low <= activeTrade.sl) {
                    exitPrice = activeTrade.sl;
                    closed = true;
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
                  const macroEma = calculateEMA(candles, 200);
                  let volSum = 0;
                  const volPeriod = Math.min(20, candles.length);
                  for(let v = candles.length - volPeriod; v < candles.length; v++) {
                      volSum += candles[v].volume;
                  }
                  const avgVol = volSum / volPeriod;

                  if (currentPrice < macroEma && candle.volume > avgVol * 1.5) {
                      activeTrade.pyramidStage = 1;
                      activeTrade.pyramidPrice = tp;
                      activeTrade.sl = Math.min(activeTrade.sl, entryPrice);
                  }
                }
                
                if (pyramidStage > 0) {
                  activeTrade.sl = Math.min(activeTrade.sl, chandelierShort);
                }
                
                if (candle.high >= activeTrade.sl) {
                    exitPrice = activeTrade.sl;
                    closed = true;
                }
            }
            
            if (closed) {
                let rawPnl = 0;
                let totalEntryVolume = 0;
                let totalExitVolume = 0;
                
                // DYNAMIC POSITION SIZING: Based on balance + leverage
                let baseRisk = currentRiskPct;
                let maxKellyRisk = currentRiskPct * 2;
                
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
                
                if (drawdownPercent > 2) {
                    riskMultiplier *= Math.pow(0.5, drawdownPercent / 5); 
                }
                
                const atr = calculateATR(candles, 14);
                const volRatio = (atr / currentPrice) * 100;
                const volDiscount = Math.max(1, volRatio / 4);
                riskMultiplier /= volDiscount;
                
                let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
                const maxPositionSize = activeTrade.balanceAtEntry * currentLeverage;  // USE DYNAMIC LEVERAGE
                const maxAccountPercent = activeTrade.balanceAtEntry * 0.05;
                if (basePositionSize > maxPositionSize) basePositionSize = maxPositionSize;
                if (basePositionSize > maxAccountPercent) basePositionSize = maxAccountPercent;
                if (basePositionSize > HARD_POSITION_CAP) basePositionSize = HARD_POSITION_CAP;
                
                if (activeTrade.pyramidStage === 0) {
                   const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
                   rawPnl = basePositionSize * movePerc;
                   totalEntryVolume = basePositionSize;
                   totalExitVolume = basePositionSize;
                } 
                else if (activeTrade.pyramidStage === 1) {
                   const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
                   rawPnl = (basePositionSize * 2) * movePerc;
                   totalEntryVolume = basePositionSize * 2;
                   totalExitVolume = basePositionSize * 2;
                }
                
                // REALISTIC SLIPPAGE: 0.04% base + tiny adaptive
                const adaptiveSlippage = Math.min(0.0006, ((atr / currentPrice) * 0.1));
                const entryFee = totalEntryVolume * (MAKER_FEE + adaptiveSlippage * 0.3);
                const exitFee = totalExitVolume * (MAKER_FEE + adaptiveSlippage);
                pnl = rawPnl - entryFee - exitFee;
                
                balance += pnl;
                stats.totalFeesPaid += (entryFee + exitFee);
                stats.totalTrades++;
                
                if (!stats.symbolStats[activeTrade.symbol]) stats.symbolStats[activeTrade.symbol] = { trades: 0, pnl: 0 };
                stats.symbolStats[activeTrade.symbol].trades++;
                stats.symbolStats[activeTrade.symbol].pnl += pnl;
                
                if (pnl > 0) {
                   stats.wins++;
                   stats.grossProfit += pnl;
                   consecutiveLosses = 0;
                }
                else if (pnl > -2 && pnl < 2) stats.breakEvens++; 
                else {
                   stats.losses++;
                   stats.grossLoss += Math.abs(pnl);
                   consecutiveLosses++;
                   if (consecutiveLosses >= 3) {
                       circuitBreakerActive = true;
                   }
                }
                
                // DYNAMIC CIRCUIT BREAKER: Stricter as balance grows
                const drawdownThreshold = stats.peakBalance * cbThreshold;
                if (balance < drawdownThreshold && stats.totalTrades > 10) {
                    circuitBreakerActive = true;
                    if (i % 100 === 0) {
                        console.log(`⚠️  Circuit Breaker (${(cbThreshold * 100).toFixed(0)}%): Balance $${balance.toFixed(0)} < Threshold $${drawdownThreshold.toFixed(0)} - Halting`);
                    }
                }
                
                const half = date.getMonth() < 6 ? 'H1' : 'H2';
                const period = `${year}-${half}`;
                if (!stats.periods[period]) stats.periods[period] = { trades: 0, wins: 0, pnl: 0 };
                stats.periods[period].trades++;
                stats.periods[period].wins += pnl > 0 ? 1 : 0;
                stats.periods[period].pnl += pnl;
                
                delete activeTrades[symbol];
                lastTradeClosedTime[symbol] = timestamp;
            }
        }
        
        // TRADE ENTRY LOGIC
        const regime = detectRegime(candles);
        const maxConcurrent = regime === 'TRENDING' ? 10 : 3;
        
        if (circuitBreakerActive) {
            const chop = calculateChoppinessIndex(candles, 288);
            if (chop < 50) {
                circuitBreakerActive = false;
                consecutiveLosses = 0;
            } else {
                continue;
            }
        }
        
        if (Object.keys(activeTrades).length >= maxConcurrent) continue;
        const lastClose = lastTradeClosedTime[symbol] || 0;
        if (timestamp - lastClose < 1000 * 60 * 15) continue;
        
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
        const hurstForSL = calculateHurstExponent(candles, 50);
        const atrMultiplier = getHurstAdaptiveATRMultiplier(hurstForSL);
        let dynamicSL = (atr / currentPrice) * atrMultiplier;
        if (dynamicSL < 0.003) dynamicSL = 0.003;
        
        // Entry logic continues (rest of trade entry unchanged from original megalodon)
        const capitulation = detectCapitulationSync(candles, 200);
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
        
        // (Rest of entry filters from original megalodon...)
        // For brevity, simplified here - full logic in megalodon.ts
        
        const shouldSkipEntry = balance < (stats.peakBalance * 0.50) && stats.totalTrades > 50;
        
        if (action && !shouldSkipEntry) {
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
    console.log(`   SNOWBALL BACKTEST (DYNAMIC LEVERAGE)`);
    console.log(`============================================`);
    console.log(`Final Balance:    $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     $${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPercent.toFixed(2)}%)`);
    console.log(`Total Fees Paid:  $${stats.totalFeesPaid.toFixed(2)}`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Win Rate:         ${((stats.wins / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Loss Rate:        ${((stats.losses / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Break-Evens:      ${((stats.breakEvens / stats.totalTrades) * 100).toFixed(2)}%\n`);
    
    console.log(`--- LEVERAGE SCALING HISTORY ---`);
    const uniqueLeverages = stats.leverageHistory.filter((l, i) => i === 0 || stats.leverageHistory[i-1].leverage !== l.leverage);
    for (const lh of uniqueLeverages.slice(0, 10)) {
        const date = new Date(lh.time);
        console.log(`${date.toISOString().split('T')[0]}: ${lh.leverage}x leverage at $${lh.balance.toFixed(0)}`);
    }
    
    console.log(`\n--- PERIOD BREAKDOWN ---`);
    const sortedPeriods = Object.keys(stats.periods).sort();
    let runningBalance = INITIAL_CAPITAL;
    for (const period of sortedPeriods) {
        const pStats = stats.periods[period];
        runningBalance += pStats.pnl;
        console.log(`${period}: $${runningBalance.toFixed(0)} (${((pStats.wins / pStats.trades) * 100).toFixed(1)}% WR, ${pStats.trades} trades)`);
    }
    
    console.log(`\n============================================`);
}

runSnowballBacktest().catch(console.error);
