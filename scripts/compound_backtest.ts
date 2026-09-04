import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';

// Backtest Config
const INITIAL_CAPITAL = 1000;
const RISK_PERC = 0.01; // 1% of current balance per trade
const MAKER_FEE = 0.0002;
const TAKER_FEE = 0.0005;
const SL_BUFFER = 0.003;
const SMC_LOOKBACK = 10; 

async function runBacktest() {
  const filePath = path.join(process.cwd(), 'data', 'btc_5m_history.csv');
  let balance = INITIAL_CAPITAL;
  let activeTrade: any = null;
  const candles: any[] = [];
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isFirstLine = true;
  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; }
    if (!line.trim()) continue;
    
    const cols = line.split(',');
    if (cols.length < 6) continue;
    
    const candle = { timestamp: Number(cols[0]), open: Number(cols[1]), high: Number(cols[2]), low: Number(cols[3]), close: Number(cols[4]), volume: Number(cols[5]) };
    candles.push(candle);
    
    if (candles.length > SMC_LOOKBACK + 5) candles.shift();
    if (candles.length < SMC_LOOKBACK) continue;
    
    const currentPrice = candle.close;
    
    if (balance <= 0) break; // Bankrupt

    if (activeTrade) {
      let closed = false;
      let pnl = 0;
      let exitPrice = 0;
      let isWin = false;
      const { entryPrice, sl, tp, action, pyramidStage, initialSl, riskAmount } = activeTrade;
      
      if (action === 'BUY') {
        if (candle.low <= sl) { exitPrice = sl; closed = true; } 
        else if (pyramidStage === 0 && candle.high >= entryPrice + (tp - entryPrice) * 0.5) {
          activeTrade.sl = entryPrice; activeTrade.pyramidStage = 1;
        }
        else if (candle.high >= tp) { exitPrice = tp; closed = true; isWin = true; }
      } else {
        if (candle.high >= sl) { exitPrice = sl; closed = true; } 
        else if (pyramidStage === 0 && candle.low <= entryPrice - (entryPrice - tp) * 0.5) {
          activeTrade.sl = entryPrice; activeTrade.pyramidStage = 1;
        }
        else if (candle.low <= tp) { exitPrice = tp; closed = true; isWin = true; }
      }
      
      if (closed) {
        const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
        const positionMultiplier = activeTrade.pyramidStage > 0 ? 2 : 1; 
        const stopLossPerc = Math.abs(entryPrice - initialSl) / entryPrice;
        const positionSize = riskAmount / stopLossPerc;
        
        const rawPnl = positionSize * movePerc * positionMultiplier;
        const entryFee = positionSize * TAKER_FEE;
        const exitFee = (positionSize + Math.abs(rawPnl)) * (isWin ? MAKER_FEE : TAKER_FEE);
        
        balance += (rawPnl - entryFee - exitFee);
        activeTrade = null;
      }
      continue;
    }
    
    const { supports, resistances } = calculateGannSquareOf9(currentPrice);
    let closestSupport = 0, closestResistance = 0;
    for (const s of supports) if (currentPrice >= s) { closestSupport = s; break; }
    for (const r of resistances) if (r >= currentPrice) { closestResistance = r; break; }
    
    if (closestSupport === 0 || closestResistance === 0) continue;
    
    const distanceToSupportPerc = (currentPrice - closestSupport) / currentPrice;
    const distanceToResPerc = (closestResistance - currentPrice) / currentPrice;
    
    let action = null, tp = 0, sl = 0;
    if (distanceToSupportPerc <= SL_BUFFER) {
      const longSL = closestSupport * (1 - SL_BUFFER);
      const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - longSL) >= 2.0);
      if (validTP) { action = 'BUY'; tp = validTP; sl = longSL; }
    } else if (distanceToResPerc <= SL_BUFFER) {
      const shortSL = closestResistance * (1 + SL_BUFFER);
      const validTP = supports.find(s => (currentPrice - s) / (shortSL - currentPrice) >= 2.0);
      if (validTP) { action = 'SELL'; tp = validTP; sl = shortSL; }
    }
    
    if (action) {
      const obs = findOrderBlocks(candles);
      let isValid = action === 'BUY' ? !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity) : !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity);
      
      if (isValid) {
        // Compound Risk: 1% of current balance
        const currentRisk = balance * RISK_PERC;
        activeTrade = { action, entryPrice: currentPrice, tp, sl, initialSl: sl, pyramidStage: 0, riskAmount: currentRisk };
      }
    }
  }
  
  console.log(`Final Compound Balance: $${balance.toFixed(2)}`);
}

runBacktest().catch(console.error);
