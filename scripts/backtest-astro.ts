import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });

import ccxt from 'ccxt';
import { evaluateSetup } from '../src/lib/trading/strategy';
import { Candle } from '../src/lib/trading/gann';

const exchange = new ccxt.kucoin({ enableRateLimit: true });

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

async function runBacktest() {
  console.log("🚀 Starting Backtest (1 Year - Astro Disabled)...");
  const symbol = 'BTC/USDT';
  const tf = '15m';
  // 1 year ago
  const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);

  console.log(`\nFetching 1 year of ${tf} history for ${symbol}...`);
  try {
    const ohlcv = await fetchAllOHLCV(symbol, tf, oneYearAgo);
    console.log(`Fetched ${ohlcv.length} candles for ${symbol}`);
    
    if (ohlcv.length < 100) return;

    const candles: Candle[] = ohlcv.map(c => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));

    let macroOhlcv;
    try {
      macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 365);
    } catch (err) {
      macroOhlcv = ohlcv;
    }
    
    const macroCandles: Candle[] = macroOhlcv.map(c => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));

    let virtualBalance = 1000;
    let wins = 0;
    let losses = 0;
    let totalSignals = 0;

    for (let i = 100; i < candles.length - 1; i++) {
      const window = candles.slice(i - 100, i + 1);
      const currentPrice = window[window.length - 1].close;
      
      const signal = evaluateSetup(symbol, currentPrice, window, macroCandles);
      
      if (signal.action !== "HOLD") {
        totalSignals++;
        const futureCandles = candles.slice(i + 1, Math.min(i + 100, candles.length)); 
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

        if (hitTP && !hitSL) {
          wins++;
          virtualBalance += 50; 
        } else if (hitSL) {
          losses++;
          virtualBalance -= 20; 
        }
      }
    }

    const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
    console.log(`[Result] ${symbol} | Signals: ${totalSignals} | WR: ${winRate.toFixed(2)}% | PnL: $${virtualBalance - 1000}`);
  } catch (err) {
    console.error(`Error backtesting ${symbol}:`, err);
  }
}

runBacktest();
