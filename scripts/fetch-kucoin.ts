import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';

async function fetchAndSave() {
  const exchange = new ccxt.kucoin({ enableRateLimit: true });
  const symbol = process.argv[2] || 'BTC/USDT';
  const fileName = process.argv[3] || 'btc_15m_4years.csv';
  const timeframe = '15m';
  const startDate = process.argv[4] || '2021-01-01T00:00:00Z';
  let since = exchange.parse8601(startDate);
  // End on Dec 31 2024
  const endTime = exchange.parse8601('2024-12-31T23:59:59Z');
  
  const tempPath = path.join(process.cwd(), 'data', fileName);
  fs.writeFileSync(tempPath, 'timestamp,open,high,low,close,volume\n');
  
  let fetchedCount = 0;
  console.log(`Downloading ${symbol} ${timeframe} from 2021 to 2024 via Kucoin...`);
  
  while (since < endTime) {
    try {
      // Kucoin max limit is usually 1500 for klines
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, since, 1500);
      if (ohlcv.length === 0) {
        console.log("No more data received.");
        break;
      }
      
      let csvContent = '';
      for (const c of ohlcv) {
        if (!c || c[0] === undefined || (endTime !== undefined && c[0] > endTime)) continue;
        csvContent += `${c[0]},${c[1]},${c[2]},${c[3]},${c[4]},${c[5]}\n`;
      }
      fs.appendFileSync(tempPath, csvContent);
      
      fetchedCount += ohlcv.length;
      since = (ohlcv[ohlcv.length - 1][0] as number) + 1;
      
      if (fetchedCount % 10000 < 1500) {
        console.log(`Fetched ${fetchedCount} candles... Last Date: ${new Date(since).toISOString()}`);
      }
      
      // Stop if we hit current time
      if (since >= Date.now() || since >= endTime) break;
      
      await new Promise(r => setTimeout(r, 500)); // Respect rate limits
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log(`Done! Downloaded ${fetchedCount} candles to ${tempPath}`);
}

fetchAndSave().catch(console.error);
