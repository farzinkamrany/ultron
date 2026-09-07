import ccxt from 'ccxt';

interface BacktestResult {
  symbol: string;
  roi: number;
  balance: number;
  trades: number;
  winRate: number;
  dd: number;
}

const TOP_50_SYMBOLS = [
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'ADA/USDT',
  'XRP/USDT', 'DOGE/USDT', 'AVAX/USDT', 'LINK/USDT', 'MATIC/USDT',
  'UNI/USDT', 'ATOM/USDT', 'LTC/USDT', 'NEAR/USDT', 'AAVE/USDT',
  'OP/USDT', 'ARB/USDT', 'FTM/USDT', 'CRO/USDT', 'VET/USDT',
];

async function fetch15mData(exchange: any, symbol: string, months: number = 6): Promise<any[]> {
  try {
    const candles = [];
    const timeframe = '15m';
    const limit = 1000; // Max per request
    const candlesPerMonth = (24 * 60 / 15) * 30; // ~2880 per month
    const totalNeeded = candlesPerMonth * months;

    console.log(`  ⏳ Fetching ${symbol} 15m (${totalNeeded} candles)...`);

    let since = exchange.milliseconds() - (months * 30 * 24 * 3600 * 1000); // 6 months ago

    while (candles.length < totalNeeded) {
      try {
        const ohlcv = await exchange.fetch_ohlcv(symbol, timeframe, since, limit);
        if (!ohlcv || ohlcv.length === 0) break;
        
        candles.push(...ohlcv);
        since = ohlcv[ohlcv.length - 1][0] + 1; // Next timestamp

        // Rate limit
        await new Promise(r => setTimeout(r, 50));
      } catch (e: any) {
        if (e.code === 'ENOTFOUND' || e.message.includes('not found')) {
          console.log(`  ❌ ${symbol} not available`);
          return [];
        }
        throw e;
      }
    }

    console.log(`  ✓ Got ${candles.length} candles`);
    return candles;
  } catch (err: any) {
    console.error(`  Error fetching ${symbol}:`, err.message);
    return [];
  }
}

async function runSimpleBacktest(candles: any[]): Promise<BacktestResult | null> {
  if (candles.length < 20) return null;

  let balance = 1000;
  let trades = 0;
  let wins = 0;
  let peakBalance = 1000;
  let maxDD = 0;

  // Very simplified: buy if price > SMA20, sell if price < SMA20
  const smaLength = 20;
  let activeTrade: any = null;

  for (let i = smaLength; i < candles.length; i++) {
    const close = candles[i][4];
    const sma = candles.slice(i - smaLength, i).reduce((sum, c) => sum + c[4], 0) / smaLength;

    // Update drawdown
    if (balance > peakBalance) peakBalance = balance;
    const dd = (peakBalance - balance) / peakBalance;
    if (dd > maxDD) maxDD = dd;

    // Entry signal
    if (!activeTrade && close > sma) {
      activeTrade = { entry: close, type: 'LONG' };
    } else if (!activeTrade && close < sma) {
      activeTrade = { entry: close, type: 'SHORT' };
    }

    // Exit signal
    if (activeTrade) {
      const profit = activeTrade.type === 'LONG' 
        ? (close - activeTrade.entry) / activeTrade.entry
        : (activeTrade.entry - close) / activeTrade.entry;

      if (profit > 0.03 || profit < -0.02) { // 3% TP, 2% SL
        const pnl = balance * profit * 0.99; // 1% fees
        balance += pnl;
        trades++;
        if (profit > 0) wins++;
        activeTrade = null;
      }
    }
  }

  return {
    symbol: '',
    roi: ((balance - 1000) / 1000) * 100,
    balance,
    trades,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    dd: maxDD * 100,
  };
}

async function compareTop50() {
  console.log('\n🚀 Fetching Top 50 coins 15m data...\n');

  const exchange = new ccxt.bybit({ enableRateLimit: true });
  const results: (BacktestResult & { symbol: string })[] = [];

  for (const symbol of TOP_50_SYMBOLS) {
    try {
      const candles = await fetch15mData(exchange, symbol, 6);
      
      if (candles.length < 100) {
        console.log(`  ⏭️  Skipping ${symbol} (insufficient data)`);
        continue;
      }

      const result = await runSimpleBacktest(candles);
      if (result) {
        result.symbol = symbol;
        results.push(result);
        console.log(`  ✓ ${symbol}: ${result.roi.toFixed(1)}% ROI`);
      }
    } catch (err: any) {
      console.log(`  ❌ ${symbol}: ${err.message}`);
    }
  }

  // Sort by ROI
  results.sort((a, b) => b.roi - a.roi);

  console.log('\n📊 RESULTS (Sorted by ROI):\n');
  console.log('Rank | Symbol      | ROI %      | Balance  | Trades | Win% | DD%');
  console.log('-----|-------------|------------|----------|--------|------|----');
  
  results.slice(0, 15).forEach((r, i) => {
    console.log(
      `${(i + 1).toString().padEnd(4)} | ${r.symbol.padEnd(11)} | ${r.roi.toFixed(1).padEnd(10)} | $${r.balance.toFixed(0).padEnd(7)} | ${r.trades.toString().padEnd(6)} | ${r.winRate.toFixed(1).padEnd(5)} | ${r.dd.toFixed(1)}`
    );
  });

  console.log('\n✅ Top 5 Coins for 15m Strategy:');
  results.slice(0, 5).forEach((r, i) => {
    console.log(`${i + 1}. ${r.symbol} - ${r.roi.toFixed(1)}% ROI`);
  });
}

compareTop50().catch(console.error);
