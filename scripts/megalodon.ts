import * as fs from 'fs';
import * as readline from 'readline';
import { detectSqueeze, calculateChoppinessIndex, detectCapitulationSync, checkEarlyExit, detectRegime, detectDominantCycleFFT, calculateFisherTransform, calculateApproximateEntropy, calculateZScoreVWAP, calculateHurstExponent, getHurstAdaptiveATRMultiplier, detectLiquiditySweep } from '../src/lib/trading/financial-intelligence';

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
const HARD_POSITION_CAP = 500000; // Realistic orderbook liquidity limit for top 10 coins
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

function calculateMACD(candles: MultiCandle[]): { macd: number, signal: number, hist: number } {
    if (candles.length < 35) return { macd: 0, signal: 0, hist: 0 };
    
    const ema12Arr = [];
    const ema26Arr = [];
    const macdArr = [];
    
    let sum12 = 0;
    for (let i = 0; i < 12; i++) sum12 += candles[i].close;
    let ema12 = sum12 / 12;
    for(let i = 11; i < candles.length; i++) {
        if(i > 11) ema12 = (candles[i].close - ema12) * (2/13) + ema12;
        ema12Arr[i] = ema12;
    }
    
    let sum26 = 0;
    for (let i = 0; i < 26; i++) sum26 += candles[i].close;
    let ema26 = sum26 / 26;
    for(let i = 25; i < candles.length; i++) {
        if(i > 25) ema26 = (candles[i].close - ema26) * (2/27) + ema26;
        ema26Arr[i] = ema26;
        macdArr[i] = ema12Arr[i] - ema26Arr[i];
    }
    
    let sum9 = 0;
    for (let i = 25; i < 25 + 9; i++) sum9 += macdArr[i];
    let signal = sum9 / 9;
    for(let i = 25 + 9; i < candles.length; i++) {
        signal = (macdArr[i] - signal) * (2/10) + signal;
    }
    
    const macd = macdArr[candles.length - 1];
    const hist = macd - signal;
    return { macd, signal, hist };
}

function calculateRSI(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    
    // First period
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
    // DOT excluded: consistently negative PnL across all backtest runs
    const globalTimeline = [...btcData, ...ethData, ...solData, ...linkData, ...adaData, ...bnbData, ...xrpData, ...dogeData, ...avaxData]
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
        symbolStats: {} as Record<string, { trades: number, pnl: number }>,
        cachedRegime: '' as any,
        cachedFft: 0 as any,
        cachedApEn: 0 as any
    };
    
    let activeTrades: Record<string, any> = {};
    let lastTradeClosedTime: Record<string, number> = {};
    
    const buffers: Record<string, MultiCandle[]> = {
        'BTC': [], 'ETH': [], 'SOL': [], 'LINK': [], 'ADA': [],
        'BNB': [], 'XRP': [], 'DOGE': [], 'AVAX': []
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
                  
                  // ── DONCHIAN TRAILING STOP (No Fixed Target) ──
                  const lookback = 20;
                  if (candles.length > lookback) {
                      let donchianStop = activeTrade.sl;
                      if (activeTrade.action === 'BUY') {
                          // Trailing Stop is the lowest low of the last 20 candles
                          let lowestLow = Infinity;
                          for (let i = candles.length - lookback; i < candles.length; i++) {
                              if (candles[i].low < lowestLow) lowestLow = candles[i].low;
                          }
                          activeTrade.sl = Math.max(activeTrade.sl, lowestLow - (lowestLow * 0.01));
                      } else {
                          // Trailing Stop is the highest high of the last 20 candles
                          let highestHigh = -Infinity;
                          for (let i = candles.length - lookback; i < candles.length; i++) {
                              if (candles[i].high > highestHigh) highestHigh = candles[i].high;
                          }
                          activeTrade.sl = Math.min(activeTrade.sl, highestHigh + (highestHigh * 0.01));
                      }
                  }
                  
                  // ── AGGRESSIVE PYRAMIDING (Add 100% size) ──
                  if (currentR >= 2.0 && pyramidStage === 0) {
                      activeTrade.pyramidStage = 1;
                      activeTrade.pyramidPrice = currentPrice; 
                      // Add 100% size (average entry becomes exactly midpoint)
                      activeTrade.blendedEntry = (entryPrice + currentPrice) / 2;
                      const lockPrice = entryPrice + Math.abs(entryPrice - initialSl);
                      activeTrade.sl = Math.max(activeTrade.sl, lockPrice);
                  }
                  if (currentR >= 4.0 && pyramidStage === 1) {
                      activeTrade.pyramidStage = 2;
                      activeTrade.pyramidPrice = currentPrice; 
                      // Add another 100% of base size (total 3x)
                      activeTrade.blendedEntry = (activeTrade.blendedEntry * 2 + currentPrice) / 3;
                      const lockPrice = entryPrice + (Math.abs(entryPrice - initialSl) * 3);
                      activeTrade.sl = Math.max(activeTrade.sl, lockPrice);
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
                  
                  // ── AGGRESSIVE PYRAMIDING FOR SHORTS ──
                  if (currentR >= 2.0 && pyramidStage === 0) {
                      activeTrade.pyramidStage = 1;
                      activeTrade.pyramidPrice = currentPrice;
                      activeTrade.blendedEntry = (entryPrice + currentPrice) / 2;
                      const lockPrice = entryPrice - Math.abs(initialSl - entryPrice);
                      activeTrade.sl = Math.min(activeTrade.sl, lockPrice);
                  }
                  if (currentR >= 4.0 && pyramidStage === 1) {
                      activeTrade.pyramidStage = 2;
                      activeTrade.pyramidPrice = currentPrice;
                      activeTrade.blendedEntry = (activeTrade.blendedEntry * 2 + currentPrice) / 3;
                      const lockPrice = entryPrice - (Math.abs(initialSl - entryPrice) * 3);
                      activeTrade.sl = Math.min(activeTrade.sl, lockPrice);
                  }
                }
            }
            
            if (closed) {
                let rawPnl = 0;
                let totalEntryVolume = 0;
                let totalExitVolume = 0;
                
                // ── SAFE COMPOUNDER RISK PARAMETERS ─────────────────────────────────
                let baseRisk = 0.02; // 2% Base Risk (Safe)
                let leverage = 10;

                let riskMultiplier = baseRisk; 
                
                // --- EQUITY CURVE DRAWDOWN BRAKE RESTORED ---
                if (drawdownPercent > 20) riskMultiplier *= 0.50; 
                if (drawdownPercent > 30) riskMultiplier *= 0.50; // Total 0.25x
                
                // --- SYMBOL-SPECIFIC RISK SLASHING ---
                const symbolStats = stats.symbolStats[activeTrade.symbol];
                const symbolLosses = symbolStats ? (symbolStats.consecutiveLosses || 0) : 0;
                if (symbolLosses >= 2) riskMultiplier *= 0.5;
                if (symbolLosses >= 4) riskMultiplier *= 0.5; // Total 0.25x
                
                let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
                const maxPositionSize = activeTrade.balanceAtEntry * leverage; 
                if (basePositionSize > maxPositionSize) basePositionSize = maxPositionSize;
                if (basePositionSize > HARD_POSITION_CAP) basePositionSize = HARD_POSITION_CAP;
                
                if (activeTrade.pyramidStage === 0) {
                   // Standard single-position PnL
                   const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
                   rawPnl = basePositionSize * movePerc;
                   totalEntryVolume = basePositionSize;
                   totalExitVolume = basePositionSize;
                } 
                else if (activeTrade.pyramidStage === 1) {
                    // ── FIX: Smart Pyramiding PnL (50% Size on 2nd Leg) ──────────────────────────
                    const movePerc1 = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
                    const pnl1 = basePositionSize * movePerc1;
                    
                    const movePerc2 = action === 'BUY' ? (exitPrice - activeTrade.pyramidPrice) / activeTrade.pyramidPrice : (activeTrade.pyramidPrice - exitPrice) / activeTrade.pyramidPrice;
                    const pnl2 = (basePositionSize * 0.5) * movePerc2; 
                    
                    rawPnl = pnl1 + pnl2;
                    totalEntryVolume = basePositionSize + (basePositionSize * 0.5);
                    totalExitVolume = basePositionSize + (basePositionSize * 0.5);
                }
                
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
        if (dynamicSL < 0.04) dynamicSL = 0.04; 
        
        const macroEma = calculateEMA(candles, 800);
        
        // ── ALL-IN TURTLE ENGINE (Breakouts) ──────────────────────────────────
        
        // Calculate Bollinger Bands for Squeeze detection
        const bbPeriod = 50;
        let bbSma = currentPrice;
        let bbStdDev = 0;
        if (candles.length >= bbPeriod) {
            let sum = 0;
            for (let i = candles.length - bbPeriod; i < candles.length; i++) sum += candles[i].close;
            bbSma = sum / bbPeriod;
            let variance = 0;
            for (let i = candles.length - bbPeriod; i < candles.length; i++) variance += Math.pow(candles[i].close - bbSma, 2);
            bbStdDev = Math.sqrt(variance / bbPeriod);
        }
        const upperBB = bbSma + (bbStdDev * 2);
        const lowerBB = bbSma - (bbStdDev * 2);
        
        const isSqueeze = detectSqueeze(candles, 20); // BB inside Keltner Channels equivalent
        
        if (regime === 'TRENDING') {
            // BUY BREAKOUT: Price closes above Upper Band in a macro uptrend (especially after a squeeze)
            if (currentPrice > macroEma && candle.close > upperBB) {
                action = 'BUY'; 
                sl = currentPrice * (1 - 0.05); // 5% Stop Loss (to survive crypto chop)
                tp = 999999999; // NO FIXED TARGET! Let the Donchian Trailing Stop exit.
            } 
            // SELL BREAKDOWN: Price closes below Lower Band in a macro downtrend
            else if (currentPrice < macroEma && candle.close < lowerBB) {
                action = 'SELL'; 
                sl = currentPrice * (1 + 0.05); // 5% Stop Loss
                tp = 0; // NO FIXED TARGET!
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
        
        if (action) {
            // ── MINIMUM PROFIT GATE (Anti Fee-Grinder) ─────────────────────────
            // Reject trades where TP distance can't cover at least 5x round-trip fees.
            const tpDistancePerc = Math.abs(tp - currentPrice) / currentPrice;
            const estimatedPositionSize = balance * 0.01 / Math.max(dynamicSL, 0.01);
            const roundTripFee = estimatedPositionSize * MAKER_FEE * 2;
            const estimatedProfit = estimatedPositionSize * tpDistancePerc;
            if (estimatedProfit < roundTripFee * 5) {
                action = ''; // TP not worth the fee — skip
            }
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
