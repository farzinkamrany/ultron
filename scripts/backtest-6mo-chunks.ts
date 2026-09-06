import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import ccxt from 'ccxt';
import { evaluateSetup, resetCircuitBreaker, isCircuitBreakerActive, updateCircuitBreaker, CIRCUIT_BREAKER } from '../src/lib/trading/strategy';
import { Candle } from '../src/lib/trading/gann';

const exchange = new ccxt.kucoin({ enableRateLimit: true });
const FEE_RATE = 0.00035; // Hyperliquid Taker Fee (0.035%)
const STARTING_BALANCE = 1000;
const RISK_PERC = 0.02; // 2% risk per trade

async function fetchAllOHLCV(symbol: string, timeframe: string, since: number) {
  let allCandles: any[] = [];
  let currentSince = since;
  let count = 0;
  while (true) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
      if (ohlcv.length === 0) break;
      allCandles = allCandles.concat(ohlcv);
      currentSince = ohlcv[ohlcv.length - 1][0] as number + 1;
      
      count++;
      if (count % 20 === 0) {
         console.log(`Fetched ${allCandles.length} candles so far...`);
      }

      if (currentSince >= Date.now() - 1000 * 60 * 60) break;
      await new Promise(r => setTimeout(r, 400));
    } catch(e) {
      console.error("Fetch error:", e);
      break;
    }
  }
  return allCandles;
}

async function runOptimization() {
  console.log("🚀 Starting 6-Month Chunked Backtest for BTC/USDT on 15m (4 Years Total)...");
  const symbol = 'BTC/USDT';
  const tf = '15m';
  const fourYearsAgo = Date.now() - (4 * 365 * 24 * 60 * 60 * 1000);

  let macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 1500);
  const macroCandles: Candle[] = macroOhlcv.map(c => ({
    timestamp: c[0] as number, open: c[1] as number, high: c[2] as number,
    low: c[3] as number, close: c[4] as number, volume: c[5] as number,
  }));

  console.log(`\nFetching 4 years of ${tf} history for ${symbol}... This will take a minute.`);
  
  try {
    const ohlcv = await fetchAllOHLCV(symbol, tf, fourYearsAgo);
    console.log(`Finished fetching ${ohlcv.length} candles. Splitting into 6-month chunks...\n`);

    const candles: Candle[] = ohlcv.map(c => ({
      timestamp: c[0] as number, open: c[1] as number, high: c[2] as number,
      low: c[3] as number, close: c[4] as number, volume: c[5] as number,
    }));

    // 6 months roughly = 182.5 days
    const SIX_MONTHS_MS = 182.5 * 24 * 60 * 60 * 1000;
    let currentChunkStart = candles[0].timestamp;
    
    let chunkIndex = 1;
    let i = 100; // Start at 100 for window

    console.log(`==========================================================================`);
    console.log(`| Period   | Start Date | End Date   | Trades | Win % | Max DD | Final Bal`);
    console.log(`==========================================================================`);

    while (i < candles.length) {
      const chunkEndTime = currentChunkStart + SIX_MONTHS_MS;
      
      let balance = STARTING_BALANCE;
      let wins = 0, losses = 0, maxDrawdown = 0, peakBalance = balance;
      resetCircuitBreaker(balance);
      CIRCUIT_BREAKER.enabled = true;
      
      let chunkEndDate = new Date(chunkEndTime);
      let startedDate = new Date(currentChunkStart);

      while (i < candles.length && candles[i].timestamp < chunkEndTime) {
        if (isCircuitBreakerActive(i)) {
          i++;
          continue;
        }

        const window = candles.slice(i - 100, i + 1);
        const currentPrice = window[window.length - 1].close;
        const signal = evaluateSetup(symbol, currentPrice, window, macroCandles);
        
        if (signal.action !== "HOLD") {
          const slDist = Math.abs(currentPrice - signal.stopLoss) / currentPrice;
          if (slDist > 0) {
            const riskAmount = balance * RISK_PERC;
            const posValue = riskAmount / slDist;
            
            if (posValue <= balance * 20) {
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
                 const exitValue = hitTP ? (posValue * (1 + (Math.abs(signal.takeProfit - currentPrice)/currentPrice))) 
                                         : (posValue * (1 - slDist));
                 const exitFee = exitValue * FEE_RATE;
                 
                 if (hitTP && !hitSL) {
                   wins++;
                   balance += ((Math.abs(signal.takeProfit - currentPrice) / currentPrice) * posValue - entryFee - exitFee);
                   if (balance > peakBalance) peakBalance = balance;
                   updateCircuitBreaker(true, balance, i, candles[i].timestamp);
                 } else if (hitSL) {
                   losses++;
                   balance -= (riskAmount + entryFee + exitFee);
                   const dd = (peakBalance - balance) / peakBalance;
                   if (dd > maxDrawdown) maxDrawdown = dd;
                   updateCircuitBreaker(false, balance, i, candles[i].timestamp);
                 }

                 if (balance <= 0) { balance = 0; break; }
              }
            }
          }
        }
        i++;
      }
      
      const totalSignals = wins + losses;
      const winRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
      
      const pStr = `Chunk ${chunkIndex}`.padEnd(8);
      const startStr = startedDate.toISOString().split('T')[0];
      const endStr = new Date(Math.min(chunkEndTime, candles[candles.length-1].timestamp)).toISOString().split('T')[0];
      const trStr = String(totalSignals).padEnd(6);
      const wrStr = winRate.toFixed(1).padStart(5);
      const ddStr = (maxDrawdown * 100).toFixed(1).padStart(5);
      const balStr = balance.toFixed(0).padStart(9);
      
      console.log(`| ${pStr} | ${startStr} | ${endStr} | ${trStr} | ${wrStr}% | ${ddStr}% | $${balStr}`);
      
      currentChunkStart = chunkEndTime;
      chunkIndex++;
      if (i >= candles.length - 1) break;
    }
    console.log(`==========================================================================\n`);
  } catch (err) {
    console.error(`Error backtesting:`, err);
  }
}

runOptimization();
