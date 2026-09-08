const ccxt = require('ccxt');
const fs = require('fs');

const exchange = new ccxt.binance({ enableRateLimit: true });

// Change the symbol here to whatever you want (e.g., 'LINK/USDT', 'ADA/USDT')
const symbol = 'LINK/USDT';
const timeframe = '15m'; 

// 4 Years of Data: 2020 to 2024
const since = exchange.parse8601('2020-01-01T00:00:00Z');
const until = exchange.parse8601('2024-01-01T00:00:00Z');

async function download() {
    const safeSymbol = symbol.replace('/', '');
    const filename = `${safeSymbol}_15m_4years.csv`;
    
    console.log(`Downloading ${symbol} from Binance...`);
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
            currentSince = ohlcv[ohlcv.length - 1][0] + 1;
            
            process.stdout.write(`\rDownloaded ${allOhlcv.length} candles...`);
            
            if (ohlcv[ohlcv.length - 1][0] >= until) break;
        } catch (e) {
            console.error(`\nError: ${e.message}. Retrying in 2 seconds...`);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    
    let csv = 'timestamp,open,high,low,close,volume\n';
    for (const row of allOhlcv) {
        csv += `${row[0]},${row[1]},${row[2]},${row[3]},${row[4]},${row[5]}\n`;
    }
    fs.writeFileSync(filename, csv);
    console.log(`\n\n✅ Finished! Saved to ${filename}`);
}

download().catch(console.error);
