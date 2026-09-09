import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';
import { detectSqueeze, calculateChoppinessIndex, detectLiquiditySweep, calculateRollingVWAP, detectCandlePattern, detectCapitulation, checkEarlyExit } from '../src/lib/trading/financial-intelligence';

const INITIAL_CAPITAL = 1000;
const MAX_LOSS_LIMIT = 950; // Allow it to draw down to $50 if needed
const MAKER_FEE = 0.0001;
const MAX_OPEN_POSITIONS = 5; // Allow trading all 5 assets simultaneously
const SL_BUFFER = 0.003; 
const SMC_LOOKBACK = 1500; 

function simulateSlippage(price: number, action: string, atr: number): number {
  let slipPerc = 0.0002; 
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

async function loadDataFromCSV(filepath: string, symbol: string): Promise<any[]> {
    const fileStream = fs.createReadStream(filepath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const data: any[] = [];
    let isFirstLine = true;
    for await (const line of rl) {
        if (isFirstLine) { isFirstLine = false; continue; }
        const parts = line.split(',');
        if (parts.length < 6) continue;
        data.push({
            symbol,
            timestamp: parseInt(parts[0]),
            open: parseFloat(parts[1]),
            high: parseFloat(parts[2]),
            low: parseFloat(parts[3]),
            close: parseFloat(parts[4]),
            volume: parseFloat(parts[5])
        });
    }
    return data;
}

async function runPortfolioBacktest() {
  const assets = ['btc', 'eth', 'sol', 'bnb', 'ada'];
  let allEvents: any[] = [];
  
  console.log(`Loading CSVs for ${assets.join(', ')}...`);
  
  for (const asset of assets) {
      const filepath = path.join(process.cwd(), 'data', 'hyperliquid-15m-6months', `${asset}_15m_hyperliquid_6months.csv`);
      if (fs.existsSync(filepath)) {
          const data = await loadDataFromCSV(filepath, asset);
          allEvents = allEvents.concat(data);
          console.log(`Loaded ${data.length} candles for ${asset}`);
      } else {
          console.warn(`File not found: ${filepath}`);
      }
  }
  
  if (allEvents.length === 0) {
      console.error("No data loaded. Check if the files exist.");
      return;
  }

  console.log("Sorting events by time...");
  allEvents.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`Total events to process: ${allEvents.length}`);

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
    bySymbol: {} as Record<string, { trades: number, pnl: number }>
  };

  const activeTrades: Record<string, any> = {};
  const candlesMap: Record<string, any[]> = {};
  const lastTradeClosedTime: Record<string, number> = {};
  const lastSqueezeIndex: Record<string, number> = {};

  for (const asset of assets) {
      candlesMap[asset] = [];
      lastTradeClosedTime[asset] = 0;
      stats.bySymbol[asset] = { trades: 0, pnl: 0 };
  }

  for (const candle of allEvents) {
    const sym = candle.symbol;
    const currentPrice = candle.close;
    const date = new Date(candle.timestamp);
    
    candlesMap[sym].push(candle);
    if (candlesMap[sym].length > SMC_LOOKBACK) candlesMap[sym].shift();
    if (candlesMap[sym].length < SMC_LOOKBACK) continue;

    // TRADE MANAGEMENT
    if (activeTrades[sym]) {
      if (balance > stats.peakBalance) stats.peakBalance = balance;
      const drawdown = stats.peakBalance - balance;
      if (drawdown > stats.maxDrawdown) stats.maxDrawdown = drawdown;

      const activeTrade = activeTrades[sym];
      let closed = false;
      let pnl = 0;
      let exitPrice = 0;
      
      const { entryPrice, tp, action, pyramidStage, initialSl } = activeTrade;
      const ema150 = calculateRollingVWAP(candlesMap[sym], 150); 
      
      if (action === 'BUY') {
        const timeInTrade = candle.timestamp - activeTrade.entryTime;
        const isEarlyExit = checkEarlyExit(activeTrade, candlesMap[sym]);
        if (isEarlyExit || (pyramidStage === 0 && timeInTrade > 1000 * 60 * 60 * 16)) { exitPrice = currentPrice; closed = true; } // Time-based exit to free liquidity
        else if (candle.low <= activeTrade.sl) { exitPrice = activeTrade.sl * 0.999; closed = true; } 
        else if (pyramidStage === 0 && candle.high >= tp) { activeTrade.pyramidStage = 1; }
        else if (pyramidStage === 0 && candle.high > entryPrice * 1.015) { activeTrade.sl = entryPrice; } // Lazy break-even at 1.5% profit
        if (pyramidStage > 0) {
          activeTrade.sl = Math.max(activeTrade.sl, ema150 * 0.99); // Wider trailing stop to breathe
          if (candle.low <= activeTrade.sl) { exitPrice = activeTrade.sl; closed = true; }
        }
      } else {
        const timeInTrade = candle.timestamp - activeTrade.entryTime;
        const isEarlyExit = checkEarlyExit(activeTrade, candlesMap[sym]);
        if (isEarlyExit || (pyramidStage === 0 && timeInTrade > 1000 * 60 * 60 * 16)) { exitPrice = currentPrice; closed = true; } // Time-based exit
        else if (candle.high >= activeTrade.sl) { exitPrice = activeTrade.sl * 1.001; closed = true; } 
        else if (pyramidStage === 0 && candle.low <= tp) { activeTrade.pyramidStage = 1; }
        else if (pyramidStage === 0 && candle.low < entryPrice * 0.985) { activeTrade.sl = entryPrice; } // Lazy break-even at 1.5% profit
        if (pyramidStage > 0) {
          activeTrade.sl = Math.min(activeTrade.sl, ema150 * 1.01); // Wider trailing stop
          if (candle.high >= activeTrade.sl) { exitPrice = activeTrade.sl; closed = true; }
        }
      }
      
      if (closed) {
        let rawPnl = 0;
        let riskMultiplier = 0.01; // Base risk 1% per trade
        
        if (stats.totalTrades > 50) {
           const W = stats.wins / stats.totalTrades;
           const avgWin = stats.wins > 0 ? (stats.grossProfit / stats.wins) : 10;
           const avgLoss = stats.losses > 0 ? (stats.grossLoss / stats.losses) : 1;
           let R = avgWin / (avgLoss || 1);
           if (R < 1) R = 1;
           const kelly = W - ((1 - W) / R);
           if (kelly > 0) {
               // Moderate Half-Kelly scaling up to 5% risk per trade
               riskMultiplier = Math.max(0.01, Math.min(0.05, kelly * 0.5));
           }
        }
        
        if (activeTrade.isSqueezeAccelerated) riskMultiplier *= 1.5; 
        else if (activeTrade.isChoppy) riskMultiplier *= 0.5;
        
        let basePositionSize = activeTrade.balanceAtEntry * riskMultiplier / (Math.abs(entryPrice - initialSl) / entryPrice);
        const maxPositionSize = activeTrade.balanceAtEntry * 10; // Max 10x Leverage
        if (basePositionSize > maxPositionSize) basePositionSize = maxPositionSize;
        
        let volumeMultiplier = activeTrade.pyramidStage === 1 ? 3 : 1;
        const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
        rawPnl = (basePositionSize * volumeMultiplier) * movePerc;
        
        const entryFee = (basePositionSize * volumeMultiplier) * MAKER_FEE;
        const exitFee = (basePositionSize * volumeMultiplier) * MAKER_FEE;
        pnl = rawPnl - entryFee - exitFee;
        
        balance += pnl;
        stats.totalFeesPaid += (entryFee + exitFee);
        stats.totalTrades++;
        stats.bySymbol[sym].trades++;
        stats.bySymbol[sym].pnl += pnl;
        
        if (pnl > 0) { stats.wins++; stats.grossProfit += pnl; }
        else if (pnl > -2 && pnl < 2) stats.breakEvens++; 
        else { stats.losses++; stats.grossLoss += Math.abs(pnl); }
        
        if (balance < INITIAL_CAPITAL - MAX_LOSS_LIMIT) {
          console.log(`\n💥 LIQUIDITY POOL DRAINED at ${date.toISOString()}! Balance: $${balance.toFixed(2)}`);
          break;
        }
        
        lastTradeClosedTime[sym] = candle.timestamp;
        delete activeTrades[sym];
      }
      continue;
    }

    // NEW TRADE DETECTION
    // Pool Check: Don't exceed max simultaneous positions across the pool
    if (Object.keys(activeTrades).length >= MAX_OPEN_POSITIONS) continue;

    const symCandles = candlesMap[sym];
    const chop = calculateChoppinessIndex(symCandles, 288);
    const isHyperTrend = chop < 38.2;
    const isChoppy = chop > 50;
    if (detectSqueeze(symCandles)) lastSqueezeIndex[sym] = symCandles.length;
    
    const gann = calculateGannSquareOf9(currentPrice);
    if (!gann.supports.length || !gann.resistances.length) continue;
    
    const closestSupport = gann.supports.sort((a,b)=>b-a)[0];
    const closestResistance = gann.resistances.sort((a,b)=>a-b)[0];
    
    if (candle.timestamp - lastTradeClosedTime[sym] < 1000 * 60 * 15) continue;
    
    let action = '';
    let tp = 0;
    let sl = 0;
    
    const atr = calculateATR(symCandles);
    let dynamicSL = (atr / currentPrice) * 1.5;
    if (dynamicSL < 0.003) dynamicSL = 0.003;
    
    const capitulation = detectCapitulation(symCandles, 200);
    if (capitulation === 'BULLISH') {
        action = 'BUY'; sl = currentPrice * (1 - dynamicSL); tp = currentPrice * (1 + (dynamicSL * 3));
    } else if (capitulation === 'BEARISH') {
        action = 'SELL'; sl = currentPrice * (1 + dynamicSL); tp = currentPrice * (1 - (dynamicSL * 3));
    }
    
    if (!action) {
        if ((currentPrice - closestSupport)/currentPrice <= dynamicSL) {
            const validTP = gann.resistances.find(r => (r - currentPrice) / (currentPrice - closestSupport * (1 - dynamicSL)) >= 1.5);
            if (validTP) { action = 'BUY'; tp = validTP; sl = closestSupport * (1 - dynamicSL); }
        } else if ((closestResistance - currentPrice)/currentPrice <= dynamicSL) {
            const validTP = gann.supports.find(s => (currentPrice - s) / (closestResistance * (1 + dynamicSL) - currentPrice) >= 1.5);
            if (validTP) { action = 'SELL'; tp = validTP; sl = closestResistance * (1 + dynamicSL); }
        }
    }
    
    if (action) {
      const obs = findOrderBlocks(symCandles);
      const sweep = detectLiquiditySweep(symCandles, 60);
      
      let hasValidTrigger = false;
      const pattern = detectCandlePattern(symCandles, action === 'BUY' ? 'BULLISH' : 'BEARISH');
      if (pattern.isValid || pattern.isGolden || capitulation) hasValidTrigger = true;
      
      if (action === 'BUY') {
          if (sweep?.type === 'BULLISH' || obs.some(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && currentPrice <= ob.top * 1.001 && currentPrice >= ob.bottom * 0.999)) hasValidTrigger = true;
      } else {
          if (sweep?.type === 'BEARISH' || obs.some(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && currentPrice >= ob.bottom * 0.999 && currentPrice <= ob.top * 1.001)) hasValidTrigger = true;
      }
      
      if (hasValidTrigger) {
        const slippedEntryPrice = simulateSlippage(currentPrice, action, atr);
        const hasRecentSqueeze = (lastSqueezeIndex[sym] && symCandles.length - lastSqueezeIndex[sym] <= 15);
        activeTrades[sym] = { 
            action, entryPrice: slippedEntryPrice, tp, sl, initialSl: sl, pyramidStage: 0, 
            balanceAtEntry: balance, isSqueezeAccelerated: isHyperTrend && hasRecentSqueeze, isChoppy,
            entryTime: candle.timestamp
        };
      }
    }
  }

  console.log(`\n============================================`);
  console.log(`  ULTRON LIQUIDITY POOL BACKTEST (HFT)`);
  console.log(`============================================`);
  console.log(`Final Pool Balance: $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
  console.log(`Net Profit:         $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
  console.log(`Max Drawdown:       $${stats.maxDrawdown.toFixed(2)}`);
  console.log(`Total Fees Paid:    $${stats.totalFeesPaid.toFixed(2)}`);
  console.log(`Total Trades:       ${stats.totalTrades}`);
  console.log(`Win Rate:           ${((stats.wins / stats.totalTrades) * 100).toFixed(2)}%`);
  console.log(`Loss Rate:          ${((stats.losses / stats.totalTrades) * 100).toFixed(2)}%`);
  console.log(`Break-Evens:        ${((stats.breakEvens / stats.totalTrades) * 100).toFixed(2)}%\n`);
  
  console.log(`--- PER ASSET PERFORMANCE ---`);
  for (const asset of assets) {
      const aStat = stats.bySymbol[asset];
      console.log(`[${asset.toUpperCase()}] Trades: ${aStat.trades.toString().padEnd(4)} | PnL: $${aStat.pnl.toFixed(2)}`);
  }
  console.log(`============================================\n`);
}

runPortfolioBacktest().catch(console.error);
