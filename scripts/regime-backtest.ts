import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import ccxt from 'ccxt';
import { evaluateSetup, resetCircuitBreaker, updateCircuitBreaker, isCircuitBreakerActive, CIRCUIT_BREAKER } from '../src/lib/trading/strategy';
import { Candle } from '../src/lib/trading/gann';

const exchange = new ccxt.kucoin({ enableRateLimit: true });
const FEE_RATE = 0.00035; // Hyperliquid Taker Fee (0.035%)
const STARTING_BALANCE = 1000;
const RISK_PERC = 0.02;

// Market regime periods (approximate timestamps)
const REGIMES: { label: string; from: string; to: string; type: string }[] = [
  // Bull Markets
  { label: 'Bull 2023 Q1 (Recovery)', from: '2023-01-01', to: '2023-04-01', type: '🐂 BULL' },
  { label: 'Bull 2024 Q1 (ATH Run)', from: '2024-01-01', to: '2024-04-01', type: '🐂 BULL' },
  // Bear Markets
  { label: 'Bear 2022 H2 (Crash)', from: '2022-06-01', to: '2022-12-01', type: '🐻 BEAR' },
  { label: 'Bear 2024 Q3 (Correction)', from: '2024-07-01', to: '2024-09-30', type: '🐻 BEAR' },
  // Ranging / Sideways
  { label: 'Range 2023 H2 (Sideways)', from: '2023-06-01', to: '2023-12-01', type: '↔️ RANGE' },
  { label: 'Range 2024 Q2 (Stagnation)', from: '2024-04-01', to: '2024-07-01', type: '↔️ RANGE' },
];

async function fetchAllOHLCV(symbol: string, timeframe: string, since: number, until: number) {
  let allCandles: any[] = [];
  let currentSince = since;
  while (true) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
      if (ohlcv.length === 0) break;
      const filtered = ohlcv.filter(c => (c[0] as number) <= until);
      allCandles = allCandles.concat(filtered);
      if (filtered.length < ohlcv.length) break;
      currentSince = ohlcv[ohlcv.length - 1][0] as number + 1;
      if (currentSince >= until) break;
      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      break;
    }
  }
  return allCandles;
}

async function runBacktest(
  symbol: string, tf: string,
  ohlcv: any[], macroCandles: Candle[],
  label: string, withCB: boolean
): Promise<{ label: string, trades: number, wr: number, balance: number, maxDD: number, cbTriggered: number } | null> {
  if (ohlcv.length < 200) return null;

  const candles: Candle[] = ohlcv.map(c => ({
    timestamp: c[0] as number, open: c[1] as number, high: c[2] as number,
    low: c[3] as number, close: c[4] as number, volume: c[5] as number,
  }));

  let balance = STARTING_BALANCE;
  let wins = 0, losses = 0, totalFees = 0, cbTriggeredCount = 0;
  let maxDrawdown = 0, peakBalance = balance;

  if (withCB) {
    resetCircuitBreaker(balance);
    CIRCUIT_BREAKER.enabled = true;
  } else {
    CIRCUIT_BREAKER.enabled = false;
  }

  for (let i = 100; i < candles.length - 1; i++) {
    if (withCB && isCircuitBreakerActive(i)) {
      cbTriggeredCount++;
      continue;
    }

    const window = candles.slice(i - 100, i + 1);
    const currentPrice = window[window.length - 1].close;
    const signal = evaluateSetup(symbol, currentPrice, window, macroCandles);

    if (signal.action !== "HOLD") {
      const slDist = Math.abs(currentPrice - signal.stopLoss) / currentPrice;
      if (slDist === 0) continue;

      const riskAmount = balance * RISK_PERC;
      const posValue = riskAmount / slDist;
      if (posValue > balance * 20) continue;

      const futureCandles = candles.slice(i + 1, Math.min(i + 200, candles.length));
      let hitTP = false, hitSL = false;

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

        const won = hitTP && !hitSL;
        if (won) {
          wins++;
          const profit = (Math.abs(signal.takeProfit - currentPrice) / currentPrice) * posValue;
          balance += (profit - entryFee - exitFee);
          if (balance > peakBalance) peakBalance = balance;
        } else {
          losses++;
          balance -= (riskAmount + entryFee + exitFee);
          const dd = (peakBalance - balance) / peakBalance;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }

        if (withCB) {
          updateCircuitBreaker(won, balance, i, candles[i].timestamp);
        }

        if (balance <= 0) { balance = 0; break; }
      }
    }
  }

  const totalTrades = wins + losses;
  const wr = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  return { label, trades: totalTrades, wr, balance, maxDD: maxDrawdown * 100, cbTriggered: cbTriggeredCount };
}

async function main() {
  const symbols = ['BTC/USDT', 'ETH/USDT'];
  const timeframes = ['1h', '4h'];

  console.log("🚀 Comprehensive Backtest: ETH + BTC | Multiple TFs | Market Regimes\n");
  console.log("   With Circuit Breaker (CB): ✅  |  Without CB: ❌\n");

  for (const symbol of symbols) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${symbol}`);
    console.log(`${'═'.repeat(70)}`);

    // Fetch macro candles
    const macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 1500);
    const macroCandles: Candle[] = macroOhlcv.map(c => ({
      timestamp: c[0] as number, open: c[1] as number, high: c[2] as number,
      low: c[3] as number, close: c[4] as number, volume: c[5] as number,
    }));

    for (const tf of timeframes) {
      console.log(`\n  ┌─ Timeframe: ${tf} ─────────────────────────────────────────────`);
      console.log(`  │  ${'Regime'.padEnd(30)} | ${'CB?'.padEnd(4)} | Trades | WR%   | Final$      | MaxDD%`);
      console.log(`  │  ${'─'.repeat(78)}`);

      for (const regime of REGIMES) {
        const since = new Date(regime.from).getTime();
        const until = new Date(regime.to).getTime();
        if (until > Date.now()) continue;

        const ohlcv = await fetchAllOHLCV(symbol, tf, since, until);
        await new Promise(r => setTimeout(r, 200));

        // Run WITH circuit breaker
        const withCB = await runBacktest(symbol, tf, ohlcv, macroCandles, regime.label, true);
        // Run WITHOUT circuit breaker
        const withoutCB = await runBacktest(symbol, tf, ohlcv, macroCandles, regime.label, false);

        const regLabel = `${regime.type} ${regime.label}`;
        if (withCB) {
          const emoji = withCB.balance > STARTING_BALANCE ? '🟢' : '🔴';
          console.log(`  │  ${regLabel.substring(0,30).padEnd(30)} | ✅   | ${String(withCB.trades).padEnd(6)} | ${withCB.wr.toFixed(1).padStart(5)}% | ${emoji}$${withCB.balance.toFixed(0).padStart(9)} | ${withCB.maxDD.toFixed(1)}%`);
        }
        if (withoutCB) {
          const emoji = withoutCB.balance > STARTING_BALANCE ? '🟢' : '🔴';
          console.log(`  │  ${regLabel.substring(0,30).padEnd(30)} | ❌   | ${String(withoutCB.trades).padEnd(6)} | ${withoutCB.wr.toFixed(1).padStart(5)}% | ${emoji}$${withoutCB.balance.toFixed(0).padStart(9)} | ${withoutCB.maxDD.toFixed(1)}%`);
        }
      }
      console.log(`  └─────────────────────────────────────────────────────────────────`);
    }
  }
  console.log("\n✅ Done.\n");
}

main();
