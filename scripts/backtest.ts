import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';

// Backtest Config
const INITIAL_CAPITAL = 1000;
const MAX_LOSS_LIMIT = 900; // Allow more drawdown for compounding (90% of start)
// We will now calculate risk dynamically as 1% of balance
const MAKER_FEE = 0.0002;
const TAKER_FEE = 0.0005;
const SL_BUFFER = 0.006; // Widened from 0.003 to catch ETH and SOL Gann levels
const SMC_LOOKBACK = 10; 

async function runBacktest() {
  const fileName = process.argv[2] || 'btc_15m_4years.csv';
  const filePath = path.join(process.cwd(), 'data', fileName);
  if (!fs.existsSync(filePath)) {
    console.error("Historical CSV not found. Please run 'npx tsx scripts/fetch-history.ts' first.");
    return;
  }
  
  console.log("Starting Memory-Efficient CSV Streaming...");
  
  let balance = INITIAL_CAPITAL;
  let activeTrade: any = null;
  
  const stats = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakEvens: 0,
    totalFeesPaid: 0,
    year2021: { pnl: 0, trades: 0, wins: 0 },
    year2022: { pnl: 0, trades: 0, wins: 0 },
    year2023: { pnl: 0, trades: 0, wins: 0 },
    year2024: { pnl: 0, trades: 0, wins: 0 },
    year2025: { pnl: 0, trades: 0, wins: 0 },
    year2026: { pnl: 0, trades: 0, wins: 0 },
    maxDrawdown: 0,
    peakBalance: INITIAL_CAPITAL,
  };

  const candles: any[] = [];
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let isFirstLine = true;
  
  for await (const line of rl) {
    if (isFirstLine) {
      isFirstLine = false; // skip header
      continue;
    }
    
    if (!line.trim()) continue;
    
    const cols = line.split(',');
    if (cols.length < 6) continue;
    
    const timestamp = Number(cols[0]);
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    
    // Process 2021 to 2026
    if (year < 2021 || year > 2026) continue;
    
    // Stop after 6 months (Jan to Jun 2021)
    if (year === 2021 && date.getUTCMonth() > 5) break;
    
    const candle = { timestamp, open: Number(cols[1]), high: Number(cols[2]), low: Number(cols[3]), close: Number(cols[4]), volume: Number(cols[5]) };
    candles.push(candle);
    
    // Maintain sliding window for memory efficiency
    if (candles.length > SMC_LOOKBACK + 5) {
      candles.shift();
    }
    
    if (candles.length < SMC_LOOKBACK) continue;
    
    const currentPrice = candle.close;
    
    // Circuit Breaker
    if (balance <= INITIAL_CAPITAL - MAX_LOSS_LIMIT) {
      console.log(`\n💥 CIRCUIT BREAKER HIT at ${date.toISOString()}! Balance: $${balance.toFixed(2)}`);
      break;
    }
    
    // Update Max Drawdown
    if (balance > stats.peakBalance) stats.peakBalance = balance;
    const currentDrawdown = stats.peakBalance - balance;
    if (currentDrawdown > stats.maxDrawdown) stats.maxDrawdown = currentDrawdown;

    // --- MANAGE ACTIVE TRADE ---
    if (activeTrade) {
      let closed = false;
      let pnl = 0;
      let exitPrice = 0;
      let isWin = false;
      
      const { entryPrice, sl, tp, action, pyramidStage } = activeTrade;
      
      if (action === 'BUY') {
        if (candle.low <= sl) {
          exitPrice = sl;
          closed = true;
        } 
        else if (pyramidStage === 0 && candle.high >= entryPrice + (tp - entryPrice) * 0.5) {
          activeTrade.sl = entryPrice; // BE
          activeTrade.pyramidStage = 1;
        }
        else if (candle.high >= tp) {
          exitPrice = tp;
          closed = true;
          isWin = true;
        }
      } else {
        if (candle.high >= sl) {
          exitPrice = sl;
          closed = true;
        } 
        else if (pyramidStage === 0 && candle.low <= entryPrice - (entryPrice - tp) * 0.5) {
          activeTrade.sl = entryPrice; // BE
          activeTrade.pyramidStage = 1;
        }
        else if (candle.low <= tp) {
          exitPrice = tp;
          closed = true;
          isWin = true;
        }
      }
      
      if (closed) {
        const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
        const positionMultiplier = activeTrade.pyramidStage > 0 ? 2 : 1; 
        
        // Compounding: Risk 1% of the balance we had at entry
        const riskAmount = activeTrade.balanceAtEntry * 0.01;
        const stopLossPerc = Math.abs(entryPrice - activeTrade.initialSl) / entryPrice;
        const positionSize = riskAmount / stopLossPerc;
        
        const rawPnl = positionSize * movePerc * positionMultiplier;
        
        const entryFee = positionSize * TAKER_FEE;
        const exitFee = (positionSize + Math.abs(rawPnl)) * (isWin ? MAKER_FEE : TAKER_FEE);
        pnl = rawPnl - entryFee - exitFee;
        
        balance += pnl;
        stats.totalFeesPaid += (entryFee + exitFee);
        stats.totalTrades++;
        
        if (pnl > 0) stats.wins++;
        else if (pnl > -2 && pnl < 2) stats.breakEvens++; 
        else stats.losses++;
        
        if (year === 2021) {
          stats.year2021.trades++;
          stats.year2021.pnl += pnl;
          if (pnl > 0) stats.year2021.wins++;
        } else if (year === 2022) {
          stats.year2022.trades++;
          stats.year2022.pnl += pnl;
          if (pnl > 0) stats.year2022.wins++;
        } else if (year === 2023) {
          stats.year2023.trades++;
          stats.year2023.pnl += pnl;
          if (pnl > 0) stats.year2023.wins++;
        } else if (year === 2024) {
          stats.year2024.trades++;
          stats.year2024.pnl += pnl;
          if (pnl > 0) stats.year2024.wins++;
        } else if (year === 2025) {
          stats.year2025.trades++;
          stats.year2025.pnl += pnl;
          if (pnl > 0) stats.year2025.wins++;
        } else if (year === 2026) {
          stats.year2026.trades++;
          stats.year2026.pnl += pnl;
          if (pnl > 0) stats.year2026.wins++;
        }
        
        activeTrade = null;
      }
      continue;
    }
    
    // --- HUNT FOR SETUP ---
    let absoluteLow = Infinity;
    for (const c of candles) if (c.low < absoluteLow) absoluteLow = c.low;
    const { supports, resistances } = calculateGannSquareOf9(absoluteLow, currentPrice);
    
    let closestSupport = 0;
    for (const s of supports) {
      if (currentPrice >= s) { closestSupport = s; break; }
    }
    
    let closestResistance = 0;
    for (const r of resistances) {
      if (r >= currentPrice) { closestResistance = r; break; }
    }
    
    if (closestSupport === 0 || closestResistance === 0) continue;
    
    const distanceToSupportPerc = (currentPrice - closestSupport) / currentPrice;
    const distanceToResPerc = (closestResistance - currentPrice) / currentPrice;
    
    let action = null;
    let tp = 0;
    let sl = 0;
    let rr = 0;
    
    if (distanceToSupportPerc <= SL_BUFFER) {
      const longSL = closestSupport * (1 - SL_BUFFER);
      const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - longSL) >= 2.0);
      if (validTP) {
        action = 'BUY'; tp = validTP; sl = longSL; rr = (validTP - currentPrice) / (currentPrice - longSL);
      }
    } 
    else if (distanceToResPerc <= SL_BUFFER) {
      const shortSL = closestResistance * (1 + SL_BUFFER);
      const validTP = supports.find(s => (currentPrice - s) / (shortSL - currentPrice) >= 2.0);
      if (validTP) {
        action = 'SELL'; tp = validTP; sl = shortSL; rr = (currentPrice - validTP) / (shortSL - currentPrice);
      }
    }
    
    if (action) {
      const obs = findOrderBlocks(candles);
      let isValid = false;
      if (action === 'BUY') {
        isValid = !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && currentPrice <= ob.top * 1.001 && currentPrice >= ob.bottom * 0.999);
      } else {
        isValid = !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && currentPrice >= ob.bottom * 0.999 && currentPrice <= ob.top * 1.001);
      }
      
      if (isValid) {
        activeTrade = {
          action,
          entryPrice: currentPrice,
          tp,
          sl,
          initialSl: sl,
          pyramidStage: 0,
          balanceAtEntry: balance
        };
      }
    }
  }
  
  // PRINT REPORT
  console.log("\n============================================");
  console.log("       ULTRON BACKTEST REPORT (BTC 15m)");
  console.log("============================================");
  console.log(`Final Balance:    $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
  console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
  console.log(`Max Drawdown:     $${stats.maxDrawdown.toFixed(2)}`);
  console.log(`Total Fees Paid:  $${stats.totalFeesPaid.toFixed(2)}`);
  console.log(`Total Trades:     ${stats.totalTrades}`);
  console.log(`Win Rate:         ${((stats.wins / stats.totalTrades) * 100).toFixed(2)}%`);
  console.log(`Loss Rate:        ${((stats.losses / stats.totalTrades) * 100).toFixed(2)}%`);
  console.log(`Break-Evens:      ${((stats.breakEvens / stats.totalTrades) * 100).toFixed(2)}%`);
  
  console.log("\n--- 2021 ---");
  const win2021 = stats.year2021.trades > 0 ? ((stats.year2021.wins / stats.year2021.trades) * 100).toFixed(2) : '0.00';
  console.log(`Trades: ${stats.year2021.trades} | PnL: $${stats.year2021.pnl.toFixed(2)} | Win Rate: ${win2021}%`);
  
  console.log("\n--- 2022 ---");
  const win2022 = stats.year2022.trades > 0 ? ((stats.year2022.wins / stats.year2022.trades) * 100).toFixed(2) : '0.00';
  console.log(`Trades: ${stats.year2022.trades} | PnL: $${stats.year2022.pnl.toFixed(2)} | Win Rate: ${win2022}%`);

  console.log("\n--- 2023 ---");
  const win2023 = stats.year2023.trades > 0 ? ((stats.year2023.wins / stats.year2023.trades) * 100).toFixed(2) : '0.00';
  console.log(`Trades: ${stats.year2023.trades} | PnL: $${stats.year2023.pnl.toFixed(2)} | Win Rate: ${win2023}%`);

  console.log("\n--- 2024 ---");
  const win2024 = stats.year2024.trades > 0 ? ((stats.year2024.wins / stats.year2024.trades) * 100).toFixed(2) : '0.00';
  console.log(`Trades: ${stats.year2024.trades} | PnL: $${stats.year2024.pnl.toFixed(2)} | Win Rate: ${win2024}%`);

  console.log("\n--- 2025 ---");
  const win2025 = stats.year2025.trades > 0 ? ((stats.year2025.wins / stats.year2025.trades) * 100).toFixed(2) : '0.00';
  console.log(`Trades: ${stats.year2025.trades} | PnL: $${stats.year2025.pnl.toFixed(2)} | Win Rate: ${win2025}%`);

  console.log("\n--- 2026 ---");
  const win2026 = stats.year2026.trades > 0 ? ((stats.year2026.wins / stats.year2026.trades) * 100).toFixed(2) : '0.00';
  console.log(`Trades: ${stats.year2026.trades} | PnL: $${stats.year2026.pnl.toFixed(2)} | Win Rate: ${win2026}%`);
  console.log("============================================\n");
}

runBacktest().catch(console.error);
