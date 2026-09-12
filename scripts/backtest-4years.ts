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
  console.log("🚀 Starting 4-Year Backtest for BTC/USDT on 15m (Hyperliquid Fees)...");
  const symbol = 'BTC/USDT';
  const tf = '15m';
  const fourYearsAgo = Date.now() - (4 * 365 * 24 * 60 * 60 * 1000);

  // Fetch macro once
  let macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 1500);
  const macroCandles: Candle[] = macroOhlcv.map(c => ({
    timestamp: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));

  console.log(`\nFetching 4 years of ${tf} history for ${symbol}... This will take a minute.`);
  try {
    const ohlcv = await fetchAllOHLCV(symbol, tf, fourYearsAgo);
    console.log(`Finished fetching ${ohlcv.length} candles. Starting backtest...`);

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

    for (let i = 100; i < candles.length - 1; i++) {
      const window = candles.slice(i - 100, i + 1);
      const currentPrice = window[window.length - 1].close;
      
      const signal = await evaluateSetup(symbol, currentPrice, window, macroCandles);
      
      if (signal.action !== "HOLD") {
        const slDist = Math.abs(currentPrice - signal.stopLoss) / currentPrice;
        if (slDist === 0) continue;
        
        const riskAmount = balance * RISK_PERC;
        const posValue = riskAmount / slDist;
        
        // Skip unrealistic leverage (>20x)
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
           const exitValue = hitTP ? (posValue * (1 + (Math.abs(signal.takeProfit - currentPrice)/currentPrice))) 
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
             const currentDrawdown = (peakBalance - balance) / peakBalance;
             if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;
           }

           // Stop if liquidated
           if (balance <= 0) {
             console.log(`\n☠️ LIQUIDATED at candle ${i} (Date: ${new Date(candles[i].timestamp).toLocaleDateString()})`);
             balance = 0;
             break;
           }
        }
      }
    }

    const totalSignals = wins + losses;
    const winRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
    console.log(`\n================================`);
    console.log(`[FINAL RESULT] ${symbol} ${tf} (4 Years)`);
    console.log(`Total Trades: ${totalSignals}`);
    console.log(`Win Rate:     ${winRate.toFixed(2)}%`);
    console.log(`Max Drawdown: ${(maxDrawdown * 100).toFixed(2)}%`);
    console.log(`Total Fees:   $${totalFees.toFixed(2)}`);
    console.log(`Final Bal:    $${balance.toFixed(2)}`);
    console.log(`================================\n`);
  } catch (err) {
    console.error(`Error backtesting:`, err);
  }
}

runOptimization();
