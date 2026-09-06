import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import ccxt from 'ccxt';
import { evaluateSetup, resetCircuitBreaker, updateCircuitBreaker, isCircuitBreakerActive } from '../src/lib/trading/strategy';
import { Candle } from '../src/lib/trading/gann';

const exchange = new ccxt.kucoin({ enableRateLimit: true });
const FEE_RATE = 0.00035; // Hyperliquid
const RISK_PERC = 0.02;

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
    } catch { break; }
  }
  return allCandles;
}

async function simulate(symbol: string, tf: string, startingCapital: number, macroCandles: Candle[], ohlcv: any[]) {
  const candles: Candle[] = ohlcv.map(c => ({
    timestamp: c[0] as number, open: c[1] as number, high: c[2] as number,
    low: c[3] as number, close: c[4] as number, volume: c[5] as number,
  }));

  let balance = startingCapital;
  let wins = 0, losses = 0, cbPaused = 0;
  let maxDrawdown = 0, peakBalance = balance;
  const monthly: { date: string, balance: number }[] = [];
  let lastMonth = -1;

  resetCircuitBreaker(balance);

  for (let i = 100; i < candles.length - 1; i++) {
    const date = new Date(candles[i].timestamp);
    if (date.getMonth() !== lastMonth) {
      monthly.push({ date: date.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long' }), balance: Math.round(balance) });
      lastMonth = date.getMonth();
    }

    if (isCircuitBreakerActive(i)) { cbPaused++; continue; }

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
      for (const f of futureCandles) {
        if (signal.action === 'BUY') { if (f.low <= signal.stopLoss) hitSL = true; if (f.high >= signal.takeProfit) hitTP = true; }
        else { if (f.high >= signal.stopLoss) hitSL = true; if (f.low <= signal.takeProfit) hitTP = true; }
        if (hitTP || hitSL) break;
      }

      if (hitTP || hitSL) {
        const entryFee = posValue * FEE_RATE;
        const exitValue = hitTP ? posValue * (1 + Math.abs(signal.takeProfit - currentPrice) / currentPrice) : posValue * (1 - slDist);
        const exitFee = exitValue * FEE_RATE;
        const won = hitTP && !hitSL;

        if (won) {
          wins++;
          balance += (Math.abs(signal.takeProfit - currentPrice) / currentPrice) * posValue - entryFee - exitFee;
          if (balance > peakBalance) peakBalance = balance;
        } else {
          losses++;
          balance -= (riskAmount + entryFee + exitFee);
          const dd = (peakBalance - balance) / peakBalance;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }
        updateCircuitBreaker(won, balance, i, candles[i].timestamp);
        if (balance <= 0) { balance = 0; break; }
      }
    }
  }

  const total = wins + losses;
  return { wins, losses, wr: total > 0 ? wins / total * 100 : 0, balance, maxDD: maxDrawdown * 100, monthly, cbPaused };
}

async function main() {
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  console.log("⚙️  Fetching data...");
  const ethMacro = (await exchange.fetchOHLCV('ETH/USDT', '1d', undefined, 800)).map(c => ({ timestamp: c[0] as number, open: c[1] as number, high: c[2] as number, low: c[3] as number, close: c[4] as number, volume: c[5] as number }));
  const btcMacro = (await exchange.fetchOHLCV('BTC/USDT', '1d', undefined, 800)).map(c => ({ timestamp: c[0] as number, open: c[1] as number, high: c[2] as number, low: c[3] as number, close: c[4] as number, volume: c[5] as number }));

  const eth15m = await fetchAllOHLCV('ETH/USDT', '15m', oneYearAgo);
  const btc15m = await fetchAllOHLCV('BTC/USDT', '15m', oneYearAgo);
  
  const eth5m = await fetchAllOHLCV('ETH/USDT', '5m', oneYearAgo);
  const btc5m = await fetchAllOHLCV('BTC/USDT', '5m', oneYearAgo);

  const capitals = [1000];

  for (const [label, ohlcv, macro] of [
    ['BTC/USDT 15m', btc15m, btcMacro], 
    ['ETH/USDT 15m', eth15m, ethMacro],
    ['BTC/USDT 5m', btc5m, btcMacro],
    ['ETH/USDT 5m', eth5m, ethMacro]
  ] as [string, any[], Candle[]][]) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  📊 ${label} | 1-Year Continuous (With Circuit Breaker)`);
    console.log(`${'═'.repeat(60)}`);

    const result = await simulate(label.split(' ')[0], label.split(' ')[1], 1000, macro, ohlcv);
    console.log(`\n  WinRate: ${result.wr.toFixed(2)}% | MaxDrawdown: ${result.maxDD.toFixed(1)}% | CB Paused: ${result.cbPaused} candles`);

    console.log(`\n  💰 Growth Table (Starting Capital → Final Balance):`);
    console.log(`  ${'─'.repeat(45)}`);
    for (const cap of capitals) {
      const final = cap * (result.balance / 1000);
      const multiplier = final / cap;
      const emoji = multiplier > 1 ? '🟢' : '🔴';
      console.log(`  ${emoji} $${cap.toLocaleString().padStart(7)} → $${Math.round(final).toLocaleString().padStart(12)}  (${multiplier.toFixed(1)}x in 1 year)`);
    }
  }
  console.log('\n✅ Done.\n');
}

main();
