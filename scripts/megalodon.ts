import fs from 'fs';
import readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';
import { detectSqueeze, calculateChoppinessIndex, detectLiquiditySweep, calculateRollingVWAP, calculateVolumeProfile, synthesizeDailyCandles, detectDailyTrend, detectCandlePattern, detectCapitulation, checkEarlyExit } from '../src/lib/trading/financial-intelligence';

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
const MAKER_FEE = 0.0001;

function calculateATR(candles: any[], period: number = 14): number {
    if (candles.length < period + 1) return 0;
    let trSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const c = candles[i];
        const p = candles[i - 1];
        const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        trSum += tr;
    }
    return trSum / period;
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
    const btcData = await loadCSV('data/btc_15m_4years.csv', 'BTC');
    const ethData = await loadCSV('data/eth_15m_4years.csv', 'ETH');
    const solData = await loadCSV('data/sol_15m_3years.csv', 'SOL');
    const linkData = await loadCSV('data/link_15m_4years.csv', 'LINK');
    const adaData = await loadCSV('data/ada_15m_4years.csv', 'ADA');
    const bnbData = await loadCSV('data/bnb_15m_4years.csv', 'BNB');
    const xrpData = await loadCSV('data/xrp_15m_4years.csv', 'XRP');
    const dogeData = await loadCSV('data/doge_15m_4years.csv', 'DOGE');
    const avaxData = await loadCSV('data/avax_15m_4years.csv', 'AVAX');
    const dotData = await loadCSV('data/dot_15m_4years.csv', 'DOT');
    
    console.log("Merging and Synchronizing Timeline...");
    const globalTimeline = [...btcData, ...ethData, ...solData, ...linkData, ...adaData, ...bnbData, ...xrpData, ...dogeData, ...avaxData, ...dotData].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return Math.random() - 0.5;
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
        peakBalance: INITIAL_CAPITAL,
        periods: {} as Record<string, { trades: number, wins: number, pnl: number }>,
        symbolStats: {} as Record<string, { trades: number, pnl: number }>
    };
    
    let activeTrade: any = null;
    let lastTradeClosedTime = 0;
    
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
        
        const date = new Date(timestamp);
        const year = date.getFullYear();
        
        // TRADE MANAGEMENT (Cross-Margin)
        if (activeTrade) {
            if (activeTrade.symbol !== symbol) continue; // Waiting for the tick of the active coin
            
            if (balance > stats.peakBalance) stats.peakBalance = balance;
            const drawdown = stats.peakBalance - balance;
            if (drawdown > stats.maxDrawdown) stats.maxDrawdown = drawdown;
            
            let closed = false;
            let pnl = 0;
            let exitPrice = 0;
            
            const { entryPrice, tp, action, pyramidStage, initialSl } = activeTrade;
            const ema150 = calculateRollingVWAP(candles, 150); 
            
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
                else if (pyramidStage === 0 && candle.high > entryPrice * 1.004) {
                   activeTrade.sl = entryPrice; 
                }
                
                if (pyramidStage > 0) {
                  activeTrade.sl = Math.max(activeTrade.sl, ema150 * 0.995); 
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
                else if (pyramidStage === 0 && candle.low < entryPrice * 0.996) {
                   activeTrade.sl = entryPrice; 
                }
                
                if (pyramidStage > 0) {
                  activeTrade.sl = Math.min(activeTrade.sl, ema150 * 1.005);
                  if (candle.high >= activeTrade.sl) { exitPrice = activeTrade.sl; closed = true; }
                }
            }
            
            if (closed) {
                let rawPnl = 0;
                let totalEntryVolume = 0;
                let totalExitVolume = 0;
                
                let baseRisk = 0.01;
                let maxKellyRisk = 0.05;
                let leverage = 15;
                
                if (activeTrade.balanceAtEntry >= 400000) {
                    baseRisk = 0.0025;
                    maxKellyRisk = 0.01;
                    leverage = 3;
                } else if (activeTrade.balanceAtEntry >= 20000) {
                    baseRisk = 0.005;
                    maxKellyRisk = 0.025;
                    leverage = 8;
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
                
                let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
                const maxPositionSize = activeTrade.balanceAtEntry * leverage; 
                if (basePositionSize > maxPositionSize) basePositionSize = maxPositionSize;
                
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
                
                const entryFee = totalEntryVolume * MAKER_FEE;
                const exitFee = totalExitVolume * MAKER_FEE;
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
                }
                else if (pnl > -2 && pnl < 2) stats.breakEvens++; 
                else {
                   stats.losses++;
                   stats.grossLoss += Math.abs(pnl);
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
                lastTradeClosedTime = timestamp;
                activeTrade = null;
            }
            continue;
        }
        
        // TRIGGER LOGIC
        if (timestamp - lastTradeClosedTime < 1000 * 60 * 15) continue; // Cooldown
        
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
        
        const capitulation = detectCapitulation(candles, 200);
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
            if (distanceToSupportPerc <= dynamicSL) {
                const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - closestSupport * (1 - dynamicSL)) >= 1.5);
                if (validTP) { action = 'BUY'; tp = validTP; sl = closestSupport * (1 - dynamicSL); }
            } 
            else if (distanceToResPerc <= dynamicSL) {
                const validTP = supports.find(s => (currentPrice - s) / (closestResistance * (1 + dynamicSL) - currentPrice) >= 1.5);
                if (validTP) { action = 'SELL'; tp = validTP; sl = closestResistance * (1 + dynamicSL); }
            }
        }
        
        if (action) {
            const chop = calculateChoppinessIndex(candles, 288);
            activeTrade = {
                symbol,
                action,
                entryPrice: currentPrice,
                entryTime: timestamp,
                sl,
                initialSl: sl,
                tp,
                pyramidStage: 0,
                balanceAtEntry: balance, // Cross margin is magically supported!
                isChoppy: chop > 50,
                isSqueezeAccelerated: detectSqueeze(candles)
            };
        }
    }
    
    console.log(`\n============================================`);
    console.log(`   MEGALODON CROSS-MARGIN BACKTEST (10 COINS)`);
    console.log(`============================================`);
    console.log(`Final Balance:    $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     $${stats.maxDrawdown.toFixed(2)}`);
    console.log(`Total Fees Paid:  $${stats.totalFeesPaid.toFixed(2)}`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Win Rate:         ${((stats.wins / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Loss Rate:        ${((stats.losses / stats.totalTrades) * 100).toFixed(2)}%`);
    console.log(`Break-Evens:      ${((stats.breakEvens / stats.totalTrades) * 100).toFixed(2)}%\n`);
    
    const sortedPeriods = Object.keys(stats.periods).sort();
    for (const period of sortedPeriods) {
        const pStats = stats.periods[period];
        console.log(`--- ${period} ---`);
        console.log(`Trades: ${pStats.trades} | PnL: $${pStats.pnl.toFixed(2)} | Win Rate: ${((pStats.wins / pStats.trades) * 100).toFixed(2)}%\n`);
    }
    
    console.log(`--- SYMBOL BREAKDOWN ---`);
    for (const sym of Object.keys(stats.symbolStats)) {
        console.log(`${sym} -> Trades: ${stats.symbolStats[sym].trades} | PnL: $${stats.symbolStats[sym].pnl.toFixed(2)}`);
    }
    console.log(`============================================\n`);
}

runMegalodon().catch(console.error);
