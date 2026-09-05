import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';

// Backtest Config
const INITIAL_CAPITAL = 1000;
const MAKER_FEE = 0.0002;
const TAKER_FEE = 0.0005;
const SL_BUFFER = 0.003;
const SMC_LOOKBACK = 10;

async function runHarvestBacktest() {
  const filePath = path.join(process.cwd(), 'data', 'btc_15m_4years.csv');
  if (!fs.existsSync(filePath)) {
    console.error("Historical CSV not found.");
    return;
  }

  let balance = INITIAL_CAPITAL;
  let activeTrade: any = null;
  let riskPercent = 0.01; // Start with 1%
  let hasEscaped = false; // Phase 1 to Phase 2 transition
  let totalWithdrawn = 0;
  
  // For monthly harvesting
  let currentMonth = -1;
  let startOfMonthBalance = balance;

  const stats = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    year1: { withdrawn: 0, balance: 0 },
    year2: { withdrawn: 0, balance: 0 },
  };

  const candles: any[] = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isFirstLine = true;
  let currentYear = 0;

  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; }
    if (!line.trim()) continue;

    const cols = line.split(',');
    if (cols.length < 6) continue;

    const timestamp = Number(cols[0]);
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    
    // Process 2021 to 2022 (User asked for 1 and 2 years, we will simulate 2 years: 2021 and 2022)
    if (year > 2022) continue;
    
    if (currentYear !== year && currentYear !== 0) {
      if (currentYear === 2021) {
        stats.year1.withdrawn = totalWithdrawn;
        stats.year1.balance = balance;
      } else if (currentYear === 2022) {
        stats.year2.withdrawn = totalWithdrawn;
        stats.year2.balance = balance;
      }
    }
    currentYear = year;

    // Monthly Harvesting Logic
    if (currentMonth !== month) {
      if (hasEscaped && currentMonth !== -1) {
        // We are at the start of a new month. Did we make profit last month?
        const monthlyProfit = balance - startOfMonthBalance;
        if (monthlyProfit > 0) {
          // Harvest 50% of the monthly profit
          const harvestAmount = monthlyProfit * 0.5;
          balance -= harvestAmount;
          totalWithdrawn += harvestAmount;
        }
      }
      currentMonth = month;
      startOfMonthBalance = balance; // Reset for new month
    }

    const candle = { timestamp, open: Number(cols[1]), high: Number(cols[2]), low: Number(cols[3]), close: Number(cols[4]), volume: Number(cols[5]) };
    candles.push(candle);
    if (candles.length > SMC_LOOKBACK + 5) candles.shift();
    if (candles.length < SMC_LOOKBACK) continue;

    const currentPrice = candle.close;

    // --- MANAGE ACTIVE TRADE ---
    if (activeTrade) {
      let closed = false;
      let exitPrice = 0;
      let isWin = false;
      const { entryPrice, sl, tp, action, pyramidStage } = activeTrade;

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
        const stopLossPerc = Math.abs(entryPrice - activeTrade.initialSl) / entryPrice;
        
        // Position Size based on risk at entry
        const positionSize = activeTrade.riskAmount / stopLossPerc;
        const rawPnl = positionSize * movePerc * positionMultiplier;

        const entryFee = positionSize * TAKER_FEE;
        const exitFee = (positionSize + Math.abs(rawPnl)) * (isWin ? MAKER_FEE : TAKER_FEE);
        const pnl = rawPnl - entryFee - exitFee;

        balance += pnl;
        stats.totalTrades++;
        if (pnl > 0) stats.wins++; else stats.losses++;

        // ESCAPE PHASE LOGIC
        if (!hasEscaped && balance >= 3000) {
          balance -= 1000; // Withdraw initial capital
          totalWithdrawn += 1000;
          riskPercent = 0.005; // Drop risk to 0.5%
          hasEscaped = true;
          startOfMonthBalance = balance; // Reset monthly baseline
        }

        activeTrade = null;
      }
      continue;
    }

    // --- HUNT FOR SETUP ---
    const { supports, resistances } = calculateGannSquareOf9(currentPrice);
    let closestSupport = 0; for (const s of supports) if (currentPrice >= s) { closestSupport = s; break; }
    let closestResistance = 0; for (const r of resistances) if (r >= currentPrice) { closestResistance = r; break; }
    if (closestSupport === 0 || closestResistance === 0) continue;

    const distanceToSupportPerc = (currentPrice - closestSupport) / currentPrice;
    const distanceToResPerc = (closestResistance - currentPrice) / currentPrice;

    let action = null; let tp = 0; let sl = 0;

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
      const isValid = action === 'BUY' 
        ? !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity)
        : !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity);

      if (isValid) {
        activeTrade = {
          action, entryPrice: currentPrice, tp, sl, initialSl: sl, pyramidStage: 0,
          riskAmount: balance * riskPercent // Lock in risk amount for this trade
        };
      }
    }
  }
  
  // Record end of year 2
  stats.year2.withdrawn = totalWithdrawn;
  stats.year2.balance = balance;

  console.log("\n============================================");
  console.log("    REALISTIC HARVESTING MODEL (2 YEARS)");
  console.log("============================================");
  console.log(`Initial Capital: $1,000`);
  console.log(`\n--- END OF YEAR 1 (2021) ---`);
  console.log(`Cash In Your Pocket: $${stats.year1.withdrawn.toFixed(2)}`);
  console.log(`Remaining Balance:   $${stats.year1.balance.toFixed(2)}`);
  
  console.log(`\n--- END OF YEAR 2 (2022) ---`);
  console.log(`Total Cash Harvested: $${stats.year2.withdrawn.toFixed(2)}`);
  console.log(`Remaining Balance:    $${stats.year2.balance.toFixed(2)}`);
  console.log("============================================\n");
}

runHarvestBacktest().catch(console.error);
