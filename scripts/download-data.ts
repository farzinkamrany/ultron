import ccxt from 'ccxt';
import fs from 'fs';
import path from 'path';

process.env.https_proxy = 'http://127.0.0.1:10808';
process.env.http_proxy = 'http://127.0.0.1:10808';

async function downloadData() {
    const exchange = new ccxt.kucoin({ 
        enableRateLimit: true,
        proxies: {
            'http': 'http://127.0.0.1:2080',
            'https': 'http://127.0.0.1:2080'
        }
    });
    const assets = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'BNB', 'XRP', 'DOGE', 'AVAX', 'DOT'];
    const timeframe = '15m';
    const since = exchange.parse8601('2022-01-01T00:00:00Z');
    const until = exchange.parse8601('2022-12-31T23:59:59Z');
    
    const outputDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const asset of assets) {
        const symbol = `${asset}/USDT`;
        const filepath = path.join(outputDir, `${asset.toLowerCase()}_15m_2022.csv`);
        
        let allCandles: any[] = [];
        let currentSince = since;

        console.log(`Downloading ${symbol} for 2022...`);
        while (currentSince < until) {
            try {
                const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, currentSince, 1000);
                if (ohlcv.length === 0) break;
                
                allCandles = allCandles.concat(ohlcv);
                const lastCandle = ohlcv[ohlcv.length - 1];
                currentSince = (lastCandle[0] as number) + 1; // avoid duplicates
                
                await new Promise(resolve => setTimeout(resolve, exchange.rateLimit));
            } catch (error) {
                console.error(`Error fetching ${symbol}:`, error);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        console.log(`Finished ${symbol}: ${allCandles.length} total candles.`);

        const csvHeader = 'timestamp,open,high,low,close,volume\n';
        const csvRows = allCandles.map(c => `${c[0]},${c[1]},${c[2]},${c[3]},${c[4]},${c[5]}`).join('\n');
        fs.writeFileSync(filepath, csvHeader + csvRows);
    }
    console.log("Download complete.");
}

downloadData().catch(console.error);
