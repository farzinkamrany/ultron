import ccxt from 'ccxt';
import fs from 'fs';

const exchange = new ccxt.binance({
    enableRateLimit: true,
});

const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'LINK/USDT'];
const timeframe = '15m'; // We will use 15m to get 4 years faster, because the ATR and Gann logic scales perfectly.
const since = exchange.parse8601('2020-01-01T00:00:00Z') || 0;
const until = exchange.parse8601('2024-01-01T00:00:00Z') || 0;

async function download(symbol: string) {
    const shortSymbol = symbol.split('/')[0].toLowerCase();
    const filename = `data/${shortSymbol}_15m_4years.csv`;
    
    console.log(`Downloading ${symbol} ...`);
    let currentSince = since;
    let allOhlcv = [];
    
    while (currentSince < until) {
        try {
            const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
            if (ohlcv.length === 0) break;
            
            allOhlcv.push(...ohlcv);
            currentSince = ohlcv[ohlcv.length - 1][0] + 1;
            
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

async function run() {
    for (const symbol of symbols) {
        await download(symbol);
    }
    console.log("All downloads complete!");
}

run().catch(console.error);
