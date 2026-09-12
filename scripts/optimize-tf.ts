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

async function runOptimization() {
  console.log("🚀 Starting Cross-Asset Optimization (6 Months / HL Fees)...");
  const symbols = ['BTC/USDT', 'ETH/USDT'];
  const timeframes = ['15m', '1h', '4h'];
  const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);

  for (const symbol of symbols) {
    console.log(`\n========================================`);
    console.log(`🔍 Testing ${symbol}...`);
    // Fetch macro once per symbol
    let macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 365);
    const macroCandles: Candle[] = macroOhlcv.map(c => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));

    for (const tf of timeframes) {
    console.log(`\nFetching 6 months of ${tf} history for ${symbol}...`);
    try {
      const ohlcv = await fetchAllOHLCV(symbol, tf, sixMonthsAgo);
      if (ohlcv.length < 100) continue;

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

      for (let i = 100; i < candles.length - 1; i++) {
        const window = candles.slice(i - 100, i + 1);
        const currentPrice = window[window.length - 1].close;
        
        const signal = await evaluateSetup(symbol, currentPrice, window, macroCandles);
        
        if (signal.action !== "HOLD") {
          // Calculate actual Risk and Position Size based on SL
          const slDist = Math.abs(currentPrice - signal.stopLoss) / currentPrice;
          if (slDist === 0) continue;
          
          const riskAmount = balance * RISK_PERC;
          // Position value needed to lose exactly riskAmount if SL hits
          const posValue = riskAmount / slDist;
          
          // If we need leverage > 10x, skip it (unrealistic or too tight)
          if (posValue > balance * 10) continue;
          
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
             } else if (hitSL) {
               losses++;
               balance -= (riskAmount + entryFee + exitFee);
             }
          }
        }
      }

      const totalSignals = wins + losses;
      const winRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
      console.log(`[Result] ${symbol} ${tf} | Signals: ${totalSignals} | WR: ${winRate.toFixed(2)}% | Final Bal: $${balance.toFixed(2)} | Fees: $${totalFees.toFixed(2)}`);
    } catch (err) {
      console.error(`Error backtesting ${symbol} ${tf}:`, err);
    }
  }
  }
}

runOptimization();
