import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import ccxt from 'ccxt';
import { evaluateSetup, resetCircuitBreaker, isCircuitBreakerActive, updateCircuitBreaker, CIRCUIT_BREAKER } from '../src/lib/trading/strategy';
import { Candle } from '../src/lib/trading/gann';

const exchange = new ccxt.kucoin({ enableRateLimit: true });
const FEE_RATE = 0.00035; 
const STARTING_BALANCE = 1000;
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
    } catch(e) {
      break;
    }
  }
  return allCandles;
}

async function runOptimization() {
  console.log("🚀 Running Realistic 2-Year Projection with $100k Withdrawal Rule...");
  const symbol = 'BTC/USDT';
  const tf = '15m';
  const twoYearsAgo = Date.now() - (2 * 365 * 24 * 60 * 60 * 1000);

  let macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 1500);
  const macroCandles: Candle[] = macroOhlcv.map(c => ({
    timestamp: c[0] as number, open: c[1] as number, high: c[2] as number,
    low: c[3] as number, close: c[4] as number, volume: c[5] as number,
  }));

  const ohlcv = await fetchAllOHLCV(symbol, tf, twoYearsAgo);
  const candles: Candle[] = ohlcv.map(c => ({
    timestamp: c[0] as number, open: c[1] as number, high: c[2] as number,
    low: c[3] as number, close: c[4] as number, volume: c[5] as number,
  }));

  const SIX_MONTHS_MS = 182.5 * 24 * 60 * 60 * 1000;
  let currentChunkStart = candles[0].timestamp;
  
  let balance = STARTING_BALANCE;
  let totalWithdrawn = 0;
  let peakBalance = balance;
  let chunkIndex = 1;
  let i = 100; 
  
  resetCircuitBreaker(balance);
  CIRCUIT_BREAKER.enabled = true;

  console.log(`========================================================================================`);
  console.log(`| Period   | Trades | Win % | Bal at End | Withdrawn This Period | Total Cash in Pocket |`);
  console.log(`========================================================================================`);

  while (i < candles.length) {
    const chunkEndTime = currentChunkStart + SIX_MONTHS_MS;
    
    let wins = 0, losses = 0;
    let withdrawnThisPeriod = 0;
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
               } else if (hitSL) {
                 losses++;
                 balance -= (riskAmount + entryFee + exitFee);
               }

               if (balance > peakBalance) peakBalance = balance;
               updateCircuitBreaker(hitTP && !hitSL, balance, i, candles[i].timestamp);

               // The Withdrawal Rule
               if (balance >= 100000) {
                  const withdrawalAmount = balance / 2;
                  withdrawnThisPeriod += withdrawalAmount;
                  totalWithdrawn += withdrawalAmount;
                  balance /= 2;
                  peakBalance = balance;
                  resetCircuitBreaker(balance); 
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
    
    const pStr = `Month ${chunkIndex*6}`.padEnd(8);
    const trStr = String(totalSignals).padEnd(6);
    const wrStr = winRate.toFixed(1).padStart(5);
    const balStr = balance.toFixed(0).padStart(10);
    const wStr = withdrawnThisPeriod.toFixed(0).padStart(21);
    const totWStr = totalWithdrawn.toFixed(0).padStart(20);
    
    console.log(`| ${pStr} | ${trStr} | ${wrStr}% | $${balStr} | $${wStr} | $${totWStr} |`);
    
    currentChunkStart = chunkEndTime;
    chunkIndex++;
    if (i >= candles.length - 1) break;
    if (balance <= 0) {
      console.log("LIQUIDATED!");
      break;
    }
  }
  console.log(`========================================================================================\n`);
}

runOptimization();
