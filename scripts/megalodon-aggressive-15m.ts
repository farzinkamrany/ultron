/**
 * OPTIMIZED AGGRESSIVE YEAR 1: $1K → $50K
 * Strategy: 15m timeframe, Top 3 coins (BTC/ETH/SOL), 30x→15x leverage
 * 
 * Why this approach:
 * - 15m has 4x more candles/opportunities than 1H
 * - Top 3 coins = cleaner signals, less noise
 * - 30x early is aggressive but not suicidal (vs 50x)
 * - Soft 2x volume filter for quality entries
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

// OPTIMIZED LEVERAGE: 30x early (more aggressive than 20x baseline), reducing to 15x
function getDynamicLeverage(balance: number): number {
  if (balance < 2000) return 30;         // Aggressive early ($1-2K)
  if (balance < 5000) return 28;         // Still very aggressive
  if (balance < 10000) return 25;        // Aggressive
  if (balance < 25000) return 20;        // Moderate-aggressive
  if (balance < 50000) return 15;        // Moderate
  if (balance < 250000) return 8;        // Conservative
  return 3;
}

// Dynamic circuit breaker (allow more drawdown early for aggressive growth)
function getDynamicCircuitBreakerThreshold(peakBalance: number): number {
  if (peakBalance < 2000) return 0.15;   // Allow -85% when $1K
  if (peakBalance < 5000) return 0.20;   // Allow -80% when $5K
  if (peakBalance < 10000) return 0.30;  // Allow -70% when $10K
  if (peakBalance < 25000) return 0.45;  // Allow -55% when $25K
  if (peakBalance < 50000) return 0.65;  // Allow -35% when $50K
  return 0.75;
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

async function runMegalodon() {
    console.log("\n🚀 OPTIMIZED 15m AGGRESSIVE BACKTEST (BTC/ETH/SOL only, 30x→15x Leverage)\n");
    console.log("Loading 15m Data for Top 3 Coins...");
    
    const btcData = await loadCSV('data/btc_15m_history.csv', 'BTC');
    const ethData = await loadCSV('data/eth_15m_history.csv', 'ETH');
    const solData = await loadCSV('data/sol_15m_history.csv', 'SOL');
    
    console.log(`Merging and Synchronizing Timeline...\n`);
    const START_TIMESTAMP = 1514764800000;
    const globalTimeline = [...btcData, ...ethData, ...solData]
    .filter(c => c.timestamp >= START_TIMESTAMP)
    .sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        const priority: Record<string, number> = { 'BTC': 1, 'ETH': 2, 'SOL': 3 };
        const pA = priority[a.symbol] || 99;
        const pB = priority[b.symbol] || 99;
        return pA - pB;
    });
    
    console.log(`Simulation starting with ${globalTimeline.length.toLocaleString()} 15m candles.\n`);
    
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
        symbolStats: {} as Record<string, { trades: number, pnl: number }>,
        cachedRegime: '' as any,
        cachedFft: 0 as any,
        cachedApEn: 0 as any
    };
    
    let activeTrades: Record<string, any> = {};
    let lastTradeClosedTime: Record<string, number> = {};
    
    const buffers: Record<string, MultiCandle[]> = {
        'BTC': [], 'ETH': [], 'SOL': []
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

                  // SOFT VOLUME CONFIRMATION: 2x average (slightly higher than baseline 1.5x)
                  if (currentPrice > macroEma && candle.volume > avgVol * 2.0) {
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

                  // SOFT VOLUME CONFIRMATION: 2x average
                  if (currentPrice < macroEma && candle.volume > avgVol * 2.0) {
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
                
                // OPTIMIZED AGGRESSIVE LEVERAGE
                let leverage = getDynamicLeverage(activeTrade.balanceAtEntry);
                let baseRisk = 0.005;
                let maxKellyRisk = 0.015; // Max 1.5% per trade
                
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
                
                const drawdownPercent = (stats.peakBalance - balance) / stats.peakBalance * 100;
                if (drawdownPercent > 2) {
                    riskMultiplier *= Math.pow(0.5, drawdownPercent / 5); 
                }
                
                const atr = calculateATR(candles, 14);
                const volRatio = (atr / currentPrice) * 100;
                const volDiscount = Math.max(1, volRatio / 4);
                riskMultiplier /= volDiscount;
                
                let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
                const maxPositionSize = activeTrade.balanceAtEntry * leverage; 
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
                
                const cbThreshold = getDynamicCircuitBreakerThreshold(stats.peakBalance);
                const drawdownThreshold = stats.peakBalance * cbThreshold;
                if (balance < drawdownThreshold && stats.totalTrades > 10) {
                    circuitBreakerActive = true;
                }
                
                const half = date.getMonth() < 6 ? 'H1' : 'H2';
                const period = `${year}-${half}`;
                if (!stats.periods[period]) stats.periods[period] = { trades: 0, wins: 0, pnl: 0 };
                stats.periods[period].trades++;
                stats.periods[period].pnl += pnl;
                if (pnl > 0) stats.periods[period].wins++;
                
                if (balance < INITIAL_CAPITAL - MAX_LOSS_LIMIT) {
                  console.log(`💥 CIRCUIT BREAKER: Balance $${balance.toFixed(2)} at ${date.toISOString()}`);
                  break;
                }
                lastTradeClosedTime[symbol] = timestamp;
                delete activeTrades[symbol];
            }
            continue;
        }
        
        const isHourTick = (timestamp % (1000 * 60 * 60)) === 0;
        if (isHourTick || !stats.cachedRegime) {
            stats.cachedRegime = detectRegime(candles);
        }
        const regime = stats.cachedRegime;
        const maxConcurrent = 3; // Max 3 concurrent trades (only 3 coins)
        
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
        
        if (!action) {
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
        
        if (action && candles.length >= 12) {
            const { fisher } = calculateFisherTransform(candles, 10);
            if (action === 'BUY' && fisher > 2.0) action = '';
            if (action === 'SELL' && fisher < -2.0) action = '';
        }
        
        if (action && candles.length >= 50) {
            const regime = detectRegime(candles);
            if (regime === 'RANGING') {
                const { zScore } = calculateZScoreVWAP(candles, 50);
                if (action === 'BUY' && zScore > 0.5) action = '';
                if (action === 'SELL' && zScore < -0.5) action = '';
            }
        }
        
        if (action && candles.length >= 800) {
            const macroEma = calculateEMA(candles, 800);
            const weeklyEma = calculateEMA(candles, 672);
            
            const rsi = calculateRSI(candles, 14);
            let volSum = 0;
            const volPeriod = 20;
            for(let v = candles.length - volPeriod; v < candles.length; v++) {
                volSum += candles[v].volume;
            }
            const avgVol = volSum / volPeriod;
            const volSpike = candle.volume > avgVol * 3.0;
            
            let override = false;
            if (action === 'BUY' && rsi < 25 && volSpike) override = true;
            if (action === 'SELL' && rsi > 75 && volSpike) override = true;
            
            if (!override) {
                if (action === 'BUY' && currentPrice < macroEma) action = '';
                if (action === 'SELL' && currentPrice > macroEma) action = '';
                
                if (action === 'BUY' && currentPrice < weeklyEma) action = '';
                if (action === 'SELL' && currentPrice > weeklyEma) action = '';
            } else {
                sl = action === 'BUY' ? sl * 0.99 : sl * 1.01;
            }
        }
        
        if (action) {
            const rsi = calculateRSI(candles, 14);
            if (action === 'BUY' && rsi > 75) action = '';
            else if (action === 'SELL' && rsi < 25) action = '';
        }
        
        if (action) {
            let buyCount = 0, sellCount = 0;
            for (const tr of Object.values(activeTrades)) {
                if (tr.action === 'BUY') buyCount++;
                else if (tr.action === 'SELL') sellCount++;
            }
            if (action === 'BUY' && (buyCount - sellCount) >= 2) action = '';
            if (action === 'SELL' && (sellCount - buyCount) >= 2) action = '';
        }
        
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
    
    const winRate = stats.totalTrades > 0 ? (stats.wins / stats.totalTrades) * 100 : 0;
    const profitFactor = stats.grossLoss > 0 ? stats.grossProfit / stats.grossLoss : 0;
    const roi = ((balance - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
    
    console.log(`${'='.repeat(90)}`);
    console.log(`  AGGRESSIVE 15m BACKTEST (BTC/ETH/SOL, 30x→15x Leverage)\n`);
    console.log(`Final Balance:        $${balance.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`Starting Balance:     $${INITIAL_CAPITAL.toLocaleString()}`);
    console.log(`Total Profit:         $${(balance - INITIAL_CAPITAL).toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`ROI:                  ${roi.toFixed(1)}%`);
    console.log(`Multiplier:           ${(balance / INITIAL_CAPITAL).toFixed(2)}x\n`);
    
    console.log(`Total Trades:         ${stats.totalTrades}`);
    console.log(`Wins:                 ${stats.wins}`);
    console.log(`Losses:               ${stats.losses}`);
    console.log(`Break-Even:           ${stats.breakEvens}`);
    console.log(`Win Rate:             ${winRate.toFixed(1)}%`);
    console.log(`Profit Factor:        ${profitFactor.toFixed(2)}\n`);
    
    console.log(`Total Fees Paid:      $${stats.totalFeesPaid.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`Max Drawdown:         $${stats.maxDrawdown.toLocaleString('en-US', {minimumFractionDigits: 2})} (${stats.maxDrawdownPercent.toFixed(2)}%)`);
    console.log(`Peak Balance:         $${stats.peakBalance.toLocaleString('en-US', {minimumFractionDigits: 2})}\n`);
    
    console.log(`By Coin:`);
    for (const [sym, data] of Object.entries(stats.symbolStats)) {
        console.log(`  ${sym.padEnd(4)} - ${data.trades} trades | PnL: $${data.pnl.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    }
    
    console.log(`\nBy Period:`);
    for (const [period, data] of Object.entries(stats.periods)) {
        const winRate = data.trades > 0 ? (data.wins / data.trades * 100).toFixed(1) : '0.0';
        console.log(`  ${period} - ${data.trades} trades | Win Rate: ${winRate}% | PnL: $${data.pnl.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    }
    
    console.log(`${'='.repeat(90)}\n`);
    
    if (balance >= 50000) {
        console.log(`✅ YEAR 1 $50K GOAL HIT! 🎉\n`);
        console.log(`You can now:`);
        console.log(`  1. Withdraw $1K (original capital) - SAFE ✅`);
        console.log(`  2. Withdraw $49K (profit buffer) - SAFE ✅`);
        console.log(`  3. Keep remainder for pure profit scaling\n`);
    } else if (balance >= 10000) {
        console.log(`🟡 Excellent Progress! Hit $${balance.toLocaleString('en-US', {minimumFractionDigits: 2})} (${(balance/50000*100).toFixed(1)}% of $50K goal)\n`);
        const monthsToGoal = 12 * Math.log(50000 / balance) / Math.log(balance / INITIAL_CAPITAL);
        console.log(`At this trajectory: ~${Math.round(monthsToGoal)} months to $50K\n`);
    } else {
        const percentToGoal = (balance / 50000) * 100;
        console.log(`Current: $${balance.toLocaleString('en-US', {minimumFractionDigits: 2})} (${percentToGoal.toFixed(1)}% of target)`);
        console.log(`Gap:     $${(50000 - balance).toLocaleString('en-US', {minimumFractionDigits: 2})}\n`);
    }
}

runMegalodon().catch(console.error);
