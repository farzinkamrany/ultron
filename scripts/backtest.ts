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
const SMC_LOOKBACK = 30; // Increased to 30 to allow 20-period volume SMA calculation

// Market Friction Simulator
function simulateSlippage(price: number, action: string, atr: number): number {
  let slipPerc = 0.0005 + (Math.random() * 0.001); // 0.05% to 0.15%
  if (atr > price * 0.005) slipPerc *= 2; // Double slippage if ATR is high (> 0.5%)
  return action === 'BUY' ? price * (1 + slipPerc) : price * (1 - slipPerc);
}

function calculateATR(candles: any[], period: number = 14): number {
  if (candles.length < 2) return 0;
  let trSum = 0;
  for (let i = Math.max(1, candles.length - period); i < candles.length; i++) {
    const c = candles[i];
    const prevC = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevC.close), Math.abs(c.low - prevC.close));
    trSum += tr;
  }
  return trSum / Math.min(period, candles.length - 1);
}

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
  let lastTradeClosedTime = 0;
  
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
    
    const candle = { timestamp, open: Number(cols[1]), high: Number(cols[2]), low: Number(cols[3]), close: Number(cols[4]), volume: Number(cols[5]) };
    candles.push(candle);
    
    // Maintain sliding window for memory efficiency (need at least 200 for EMA)
    if (candles.length > 250) {
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
      
      const { entryPrice, sl, tp, action, pyramidStage } = activeTrade;
      
      if (action === 'BUY') {
        if (candle.low <= sl) {
          exitPrice = sl * 0.999; // 0.1% Stop-Loss Penalty
          closed = true;
        } 
        else if (pyramidStage === 0 && candle.high >= entryPrice + (tp - entryPrice) * 0.5) {
          activeTrade.sl = entryPrice; // BE
          activeTrade.pyramidStage = 1;
        }
        else if (candle.high >= tp) {
          exitPrice = tp;
          closed = true;
        }
      } else {
        if (candle.high >= sl) {
          exitPrice = sl * 1.001; // 0.1% Stop-Loss Penalty
          closed = true;
        } 
        else if (pyramidStage === 0 && candle.low <= entryPrice - (entryPrice - tp) * 0.5) {
          activeTrade.sl = entryPrice; // BE
          activeTrade.pyramidStage = 1;
        }
        else if (candle.low <= tp) {
          exitPrice = tp;
          closed = true;
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
        
        // Precise Fee Drag (0.05% on total leveraged volume)
        const totalVolume = positionSize * positionMultiplier;
        const entryFee = totalVolume * 0.0005;
        const exitFee = totalVolume * 0.0005;
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
        lastTradeClosedTime = timestamp;
      }
      continue;
    }
    
    // --- HUNT FOR SETUP ---
    // Enforce 2-hour cooldown (matching live system)
    if (timestamp - lastTradeClosedTime < 2 * 60 * 60 * 1000) {
       continue;
    }
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
    
    if (distanceToSupportPerc <= SL_BUFFER) {
      const longSL = closestSupport * (1 - SL_BUFFER);
      const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - longSL) >= 2.0);
      if (validTP) {
        action = 'BUY'; tp = validTP; sl = longSL;
      }
    } 
    else if (distanceToResPerc <= SL_BUFFER) {
      const shortSL = closestResistance * (1 + SL_BUFFER);
      const validTP = supports.find(s => (currentPrice - s) / (shortSL - currentPrice) >= 2.0);
      if (validTP) {
        action = 'SELL'; tp = validTP; sl = shortSL;
      }
    }
    
    // EMA 200 Trend Filter
    let ema200 = currentPrice;
    if (candles.length >= 200) {
      const k = 2 / (200 + 1);
      ema200 = candles[candles.length - 200].close;
      for (let i = candles.length - 199; i < candles.length; i++) {
        ema200 = (candles[i].close * k) + (ema200 * (1 - k));
      }
    }
    
    if (action === 'BUY' && currentPrice <= ema200) action = null;
    if (action === 'SELL' && currentPrice >= ema200) action = null;
    
    if (action) {
      const obs = findOrderBlocks(candles);
      
      const atr = calculateATR(candles);
      const slippedEntryPrice = simulateSlippage(currentPrice, action, atr);
      
      let isValid = false;
      if (action === 'BUY') {
        isValid = !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity && currentPrice <= ob.top * 1.001 && currentPrice >= ob.bottom * 0.999);
      } else {
        isValid = !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity && currentPrice >= ob.bottom * 0.999 && currentPrice <= ob.top * 1.001);
      }
      
      if (isValid) {
        activeTrade = {
          action,
          entryPrice: slippedEntryPrice,
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
