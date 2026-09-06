import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import ccxt from 'ccxt';
import { evaluateSetup } from '../src/lib/trading/strategy';
import { Candle } from '../src/lib/trading/gann';

const exchange = new ccxt.kucoin({ enableRateLimit: true });
const FEE_RATE = 0.00035; // Hyperliquid Taker Fee (0.035%)
const STARTING_BALANCE = 1000;
const RISK_PERC = 0.02; // 2% risk per trade

async function fetchAllOHLCV(symbol: string, timeframe: string, since: number) {
  let allCandles: any[] = [];
  let currentSince = since;
  while (true) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
      if (ohlcv.length === 0) break;
      allCandles = allCandles.concat(ohlcv);
      currentSince = ohlcv[ohlcv.length - 1][0] as number + 1;
      if (currentSince >= Date.now() - 1000 * 60 * 60) break;
      await new Promise(r => setTimeout(r, 400));
    } catch(e) {
      break;
    }
  }
  return allCandles;
}

async function runBacktest(symbol: string, tf: string, since: number, macroCandles: Candle[], label: string) {
  console.log(`\nFetching ${label} of ${tf} history for ${symbol}...`);
  const ohlcv = await fetchAllOHLCV(symbol, tf, since);
  if (ohlcv.length < 200) {
    console.log(`Not enough data for ${label}`);
    return null;
  }
  console.log(`  Fetched ${ohlcv.length} candles. Backtesting...`);

  const candles: Candle[] = ohlcv.map(c => ({
    timestamp: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));

  let balance = STARTING_BALANCE;
  let wins = 0;
  let losses = 0;
  let totalFees = 0;
  let maxDrawdown = 0;
  let peakBalance = balance;
  const monthlySnapshots: { month: string, balance: number }[] = [];
  let lastMonth = -1;

  for (let i = 100; i < candles.length - 1; i++) {
    const window = candles.slice(i - 100, i + 1);
    const currentPrice = window[window.length - 1].close;
    const month = new Date(candles[i].timestamp).getMonth();

    if (month !== lastMonth) {
      monthlySnapshots.push({ month: new Date(candles[i].timestamp).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long' }), balance });
      lastMonth = month;
    }

    const signal = evaluateSetup(symbol, currentPrice, window, macroCandles);

    if (signal.action !== "HOLD") {
      const slDist = Math.abs(currentPrice - signal.stopLoss) / currentPrice;
      if (slDist === 0) continue;

      const riskAmount = balance * RISK_PERC;
      const posValue = riskAmount / slDist;
      if (posValue > balance * 20) continue;

      const futureCandles = candles.slice(i + 1, Math.min(i + 200, candles.length));
      let hitTP = false;
      let hitSL = false;

      for (const future of futureCandles) {
        if (signal.action === 'BUY') {
          if (future.low <= signal.stopLoss) hitSL = true;
          if (future.high >= signal.takeProfit) hitTP = true;
        } else {
          if (future.high >= signal.stopLoss) hitSL = true;
          if (future.low <= signal.takeProfit) hitTP = true;
        }
        if (hitTP || hitSL) break;
      }

      if (hitTP || hitSL) {
        const entryFee = posValue * FEE_RATE;
        const exitValue = hitTP
          ? (posValue * (1 + (Math.abs(signal.takeProfit - currentPrice) / currentPrice)))
          : (posValue * (1 - slDist));
        const exitFee = exitValue * FEE_RATE;
        totalFees += (entryFee + exitFee);

        if (hitTP && !hitSL) {
          wins++;
          const profit = (Math.abs(signal.takeProfit - currentPrice) / currentPrice) * posValue;
          balance += (profit - entryFee - exitFee);
          if (balance > peakBalance) peakBalance = balance;
        } else if (hitSL) {
          losses++;
          balance -= (riskAmount + entryFee + exitFee);
          const dd = (peakBalance - balance) / peakBalance;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }

        if (balance <= 0) { balance = 0; break; }
      }
    }
  }

  const totalSignals = wins + losses;
  const winRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
  const growthMultiplier = balance / STARTING_BALANCE;

  return { balance, wins, losses, winRate, totalFees, maxDrawdown, monthlySnapshots, growthMultiplier };
}

async function main() {
  console.log("🚀 Running 2-Year ETH/USDT 1h Backtest + 6-Month Forward Projection...\n");
  const symbol = 'ETH/USDT';
  const tf = '1h';
  const twoYearsAgo = Date.now() - (2 * 365 * 24 * 60 * 60 * 1000);
  const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);

  let macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 800);
  const macroCandles: Candle[] = macroOhlcv.map(c => ({
    timestamp: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));

  const result2y = await runBacktest(symbol, tf, twoYearsAgo, macroCandles, '2 Years');
  const result1y = await runBacktest(symbol, tf, oneYearAgo, macroCandles, '1 Year');
  const result6m = await runBacktest(symbol, tf, sixMonthsAgo, macroCandles, '6 Months');

  console.log("\n");
  console.log("═══════════════════════════════════════════════════");
  console.log("        📊 HISTORICAL PERFORMANCE SUMMARY           ");
  console.log("═══════════════════════════════════════════════════");
  if (result2y) {
    console.log(`2-Year  : $1,000 → $${result2y.balance.toFixed(2)} (${(result2y.growthMultiplier).toFixed(1)}x) | WR: ${result2y.winRate.toFixed(2)}% | MaxDD: ${(result2y.maxDrawdown*100).toFixed(1)}%`);
  }
  if (result1y) {
    console.log(`1-Year  : $1,000 → $${result1y.balance.toFixed(2)} (${(result1y.growthMultiplier).toFixed(1)}x) | WR: ${result1y.winRate.toFixed(2)}% | MaxDD: ${(result1y.maxDrawdown*100).toFixed(1)}%`);
  }
  if (result6m) {
    console.log(`6-Month : $1,000 → $${result6m.balance.toFixed(2)} (${(result6m.growthMultiplier).toFixed(1)}x) | WR: ${result6m.winRate.toFixed(2)}% | MaxDD: ${(result6m.maxDrawdown*100).toFixed(1)}%`);
  }

  // Forward Projection: Use the CONSERVATIVE 1-year multiplier
  const conservativeMultiplier = result1y ? result1y.growthMultiplier : (result6m ? Math.sqrt(result6m.growthMultiplier) : 1);
  const sixMonthMultiplier = Math.pow(conservativeMultiplier, 0.5); // Half of yearly

  console.log("\n═══════════════════════════════════════════════════");
  console.log("        🔮 FORWARD PROJECTION (Next 6 Months)       ");
  console.log("═══════════════════════════════════════════════════");
  const capitals = [1000, 5000, 10000, 50000];
  for (const cap of capitals) {
    const projected = cap * sixMonthMultiplier;
    console.log(`  Capital $${cap.toLocaleString()} → ~$${projected.toFixed(0).toLocaleString()} (${sixMonthMultiplier.toFixed(1)}x)`);
  }
  console.log(`\n  ⚠️  Conservative estimate based on past 1-year performance.`);
  console.log(`  ⚠️  Past performance does not guarantee future results.`);
  console.log("═══════════════════════════════════════════════════\n");
}

main();
