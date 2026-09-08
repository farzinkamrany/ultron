import fs from 'fs';
import readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';
import { detectSqueeze, calculateChoppinessIndex, detectLiquiditySweep, calculateRollingVWAP, calculateVolumeProfile, synthesizeDailyCandles, detectDailyTrend, detectCandlePattern, detectCapitulation, checkEarlyExit, synthesizeHourlyCandles, calculateEMA, calculateADX } from '../src/lib/trading/financial-intelligence';

// HFT Backtest Config
const INITIAL_CAPITAL = 1000;
const MAX_LOSS_LIMIT = 900;
const MAKER_FEE = 0.0001;
const TAKER_FEE = 0.0001; 
const SL_BUFFER = 0.003; // Ultra tight stop loss
const SMC_LOOKBACK = 1500; 

function simulateSlippage(price: number, action: string, atr: number): number {
  let slipPerc = 0.0002; // Very small slippage assumption for limit orders
  return action === 'BUY' ? price * (1 + slipPerc) : price * (1 - slipPerc);
}

function calculateATR(candles: any[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  let trSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i-1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  return trSum / period;
}

async function runBacktest() {
  const fileStream = fs.createReadStream(process.argv[2]);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let candles: any[] = [];
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
    lastSqueezeIndex: 0,
    periods: {} as Record<string, { trades: number, wins: number, pnl: number }>
  };

  let activeTrade: any = null;
  let lastTradeClosedTime = 0;
  let isFirstLine = true;

  console.log("Starting Memory-Efficient HFT CSV Streaming...");

  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; }
    
    const parts = line.split(',');
    if (parts.length < 6) continue;
    
    const timestamp = parseInt(parts[0]);
    const candle = {
      timestamp,
      open: parseFloat(parts[1]),
      high: parseFloat(parts[2]),
      low: parseFloat(parts[3]),
      close: parseFloat(parts[4]),
      volume: parseFloat(parts[5])
    };
    
    candles.push(candle);
    if (candles.length > SMC_LOOKBACK) candles.shift();
    
    if (candles.length < SMC_LOOKBACK) continue;
    
    const currentPrice = candle.close;
    const date = new Date(timestamp);
    const year = date.getFullYear();

    // Trade Management
    if (activeTrade) {
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
           activeTrade.sl = entryPrice; // Ultra-aggressive break-even
        }
        
        if (pyramidStage > 0) {
          activeTrade.sl = Math.max(activeTrade.sl, ema150 * 0.995); // VWAP Trailing
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
           activeTrade.sl = entryPrice; // Ultra-aggressive break-even
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
        
        let riskMultiplier = 0.0025; // 0.25% default risk
        
        // KELLY CRITERION SCALING
        if (stats.totalTrades > 50) {
           const W = stats.wins / stats.totalTrades;
           const avgWin = stats.wins > 0 ? (stats.grossProfit / stats.wins) : 10;
           const avgLoss = stats.losses > 0 ? (stats.grossLoss / stats.losses) : 1;
           let R = avgWin / (avgLoss || 1);
           if (R < 1) R = 1;
           const kelly = W - ((1 - W) / R);
           if (kelly > 0) {
               // Quarter Kelly (Conservative Scaling)
               const optimalRisk = Math.max(0.0025, Math.min(0.02, kelly * 0.25));
               riskMultiplier = optimalRisk;
           }
        }
        
        if (activeTrade.isSqueezeAccelerated) riskMultiplier *= 1.5; 
        else if (activeTrade.isChoppy) riskMultiplier *= 0.5;
        
        let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
        
        const maxPositionSize = activeTrade.balanceAtEntry * 5; // 5x Leverage max
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

    const chop = calculateChoppinessIndex(candles, 288);
    const isHyperTrend = chop < 38.2;
    const isChoppy = chop > 50;
    const squeeze = detectSqueeze(candles);
    if (squeeze) stats.lastSqueezeIndex = candles.length;
    
    const gann = calculateGannSquareOf9(currentPrice);
    const supports = gann.supports.sort((a, b) => b - a);
    const resistances = gann.resistances.sort((a, b) => a - b);
    
    if (supports.length === 0 || resistances.length === 0) continue;
    
    const closestSupport = supports[0];
    const closestResistance = resistances[0];
    
    const distanceToSupportPerc = (currentPrice - closestSupport) / currentPrice;
    const distanceToResPerc = (closestResistance - currentPrice) / currentPrice;
    
    if (timestamp - lastTradeClosedTime < 1000 * 60 * 15) continue; // 15 min cooldown for HFT
    
    let action = '';
    let tp = 0;
    let sl = 0;
    let confluenceScore = 0;
    
    // Dynamic ATR-based Stop Loss for Volatility Normalization (Megalodon)
    const atr = calculateATR(candles);
    let dynamicSL = (atr / currentPrice) * 1.5; // 1.5x ATR buffer
    if (dynamicSL < 0.003) dynamicSL = 0.003; // Absolute minimum 0.3%
    
    // AI Trading Literacy: Smart Entry via Capitulation
    const capitulation = detectCapitulation(candles, 200);
    if (capitulation === 'BULLISH') {
        action = 'BUY'; 
        sl = currentPrice * (1 - dynamicSL); 
        tp = currentPrice * (1 + (dynamicSL * 5)); // 5R trailing target
    } 
    else if (capitulation === 'BEARISH') {
        action = 'SELL';
        sl = currentPrice * (1 + dynamicSL);
        tp = currentPrice * (1 - (dynamicSL * 5));
    }
    
    // Fallback to HFT Gann Logic if no capitulation
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
      const obs = findOrderBlocks(candles);
      const sweep = detectLiquiditySweep(candles, 60);
      const vwap = calculateRollingVWAP(candles, 288);
      
      let hasValidTrigger = false;
      let isPredatorTrade = false;
      
      const pattern = detectCandlePattern(candles, action === 'BUY' ? 'BULLISH' : 'BEARISH');
      if (pattern.isValid || pattern.isGolden || capitulation) hasValidTrigger = true; // Capitulation overrides all
      
      const hasRecentSqueeze = (stats.lastSqueezeIndex && candles.length - stats.lastSqueezeIndex <= 15);
      
      if (action === 'BUY') {
          const hasBullishOB = !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && currentPrice <= ob.top * 1.001 && currentPrice >= ob.bottom * 0.999);
          const hasBullishSweep = sweep?.type === 'BULLISH';
          if (hasBullishSweep || hasBullishOB) hasValidTrigger = true;
          if (currentPrice > vwap) confluenceScore += 1;
      } else {
          const hasBearishOB = !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && currentPrice >= ob.bottom * 0.999 && currentPrice <= ob.top * 1.001);
          const hasBearishSweep = sweep?.type === 'BEARISH';
          if (hasBearishSweep || hasBearishOB) hasValidTrigger = true;
          if (currentPrice < vwap) confluenceScore += 1;
      }
      
      if (hasValidTrigger) {
        const atr = calculateATR(candles);
        const slippedEntryPrice = simulateSlippage(currentPrice, action, atr);
        activeTrade = { action, entryPrice: slippedEntryPrice, tp, sl, initialSl: sl, pyramidStage: 0, balanceAtEntry: balance, isSqueezeAccelerated: isPredatorTrade || (isHyperTrend && hasRecentSqueeze), isChoppy, entryTime: timestamp };
      }
    }
  }

  console.log(`\n============================================`);
  console.log(`       ULTRON BACKTEST REPORT (HFT)`);
  console.log(`============================================`);
  console.log(`Final Balance:    $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
  console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
  console.log(`Max Drawdown:     $${stats.maxDrawdown.toFixed(2)}`);
  console.log(`Total Fees Paid:  $${stats.totalFeesPaid.toFixed(2)}`);
  console.log(`Total Trades:     ${stats.totalTrades}`);
  console.log(`Win Rate:         ${((stats.wins / stats.totalTrades) * 100).toFixed(2)}%`);
  console.log(`Loss Rate:        ${((stats.losses / stats.totalTrades) * 100).toFixed(2)}%`);
  console.log(`Break-Evens:      ${((stats.breakEvens / stats.totalTrades) * 100).toFixed(2)}%\n`);
  
  // Sort and print periods
  const sortedPeriods = Object.keys(stats.periods).sort();
  for (const period of sortedPeriods) {
      const pStats = stats.periods[period];
      console.log(`--- ${period} ---`);
      console.log(`Trades: ${pStats.trades} | PnL: $${pStats.pnl.toFixed(2)} | Win Rate: ${((pStats.wins / pStats.trades) * 100).toFixed(2)}%\n`);
  }
  console.log(`============================================\n`);
}

runBacktest().catch(console.error);
