import ccxt from 'ccxt';
import fs from 'fs';

const exchange = new ccxt.coinex({
    enableRateLimit: true,
});

const symbol = 'LINK/USDT';
const timeframe = '15m'; 
const since = exchange.parse8601('2020-01-01T00:00:00Z') || 0;
const until = exchange.parse8601('2024-01-01T00:00:00Z') || 0;

async function download() {
    const filename = `data/link_15m_4years.csv`;
    
    console.log(`Downloading ${symbol} from Coinex...`);
    let currentSince = since;
    let allOhlcv = [];
    
    while (currentSince < until) {
        try {
            const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
            if (ohlcv.length === 0) {
                currentSince += 7 * 24 * 60 * 60 * 1000; 
                continue;
            }
            
            allOhlcv.push(...ohlcv);
            currentSince = ohlcv[ohlcv.length - 1][0] + 1; // move past the last timestamp
            
            process.stdout.write(`\r${symbol}: Downloaded ${allOhlcv.length} candles...`);
            
            if (ohlcv[ohlcv.length - 1][0] >= until) break;
        } catch (e: any) {
            console.error(`\nError: ${e.message}. Retrying...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    
    let csv = 'timestamp,open,high,low,close,volume\n';
    for (const row of allOhlcv) {
        csv += `${row[0]},${row[1]},${row[2]},${row[3]},${row[4]},${row[5]}\n`;
    }
    fs.writeFileSync(filename, csv);
    console.log(`\nFinished ${symbol}. Saved to ${filename}`);
}

download().catch(console.error);
