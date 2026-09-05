import ccxt from 'ccxt';
import { evaluateSetup } from './src/lib/trading/strategy';

async function checkLiveBTC() {
  console.log("Fetching live BTC/USDT data from Binance...");
  const exchange = new ccxt.binance({
    enableRateLimit: true,
  });
  
  const symbol = 'BTC/USDT';
  
  try {
    const ohlcvRaw = await exchange.fetchOHLCV(symbol, '15m', undefined, 20);
    const candles = ohlcvRaw.map(c => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));
    
    const currentPrice = candles[candles.length - 1].close;
    console.log(`Current BTC Price: $${currentPrice}`);

    const macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 365);
    const macroCandles = macroOhlcv.map(c => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));

    console.log("Evaluating setup...");
    const signal = evaluateSetup(symbol, currentPrice, candles, macroCandles);
    
    console.log("\n=============================");
    console.log("🔥 LIVE ULTRON SIGNAL 🔥");
    console.log("=============================");
    console.log(`Symbol: ${signal.symbol}`);
    console.log(`Action: ${signal.action}`);
    console.log(`Entry:  $${signal.entryPrice}`);
    console.log(`Target: $${signal.takeProfit}`);
    console.log(`Stop:   $${signal.stopLoss}`);
    console.log(`Reason: ${signal.reason}`);
    console.log("=============================\n");

  } catch (err: any) {
    console.error("Error fetching live data:", err.message);
  }
}

checkLiveBTC();
