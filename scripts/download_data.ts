import fs from 'fs';
import https from 'https';

const symbols = ['SOLUSDT', 'AVAXUSDT', 'LINKUSDT'];
const START_TIME = 1609459200000; // Jan 1 2021
const END_TIME = 1672531199000;   // Dec 31 2022
const LIMIT = 1000;
const INTERVAL_MS = 5 * 60 * 1000;

function fetchKlines(symbol: string, startTime: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&startTime=${startTime}&limit=${LIMIT}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) return reject(new Error(`API Error ${res.statusCode}: ${data}`));
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadSymbol(symbol: string) {
    console.log(`Starting download for ${symbol}...`);
    const shortSymbol = symbol.replace('USDT', '').toLowerCase();
    const filePath = `data/${shortSymbol}_5m_history.csv`;
    
    fs.writeFileSync(filePath, 'timestamp,open,high,low,close,volume\n');
    
    let currentStartTime = START_TIME;
    let totalDownloaded = 0;
    
    while (currentStartTime < END_TIME) {
        try {
            const klines = await fetchKlines(symbol, currentStartTime);
            if (klines.length === 0) {
                console.log(`No more data for ${symbol} at ${new Date(currentStartTime).toISOString()}`);
                break;
            }
            
            let batchCsv = '';
            let lastTimestamp = 0;
            
            for (const kline of klines) {
                const ts = kline[0];
                if (ts > END_TIME) break;
                
                const open = kline[1];
                const high = kline[2];
                const low = kline[3];
                const close = kline[4];
                const volume = kline[5];
                
                batchCsv += `${ts},${open},${high},${low},${close},${volume}\n`;
                lastTimestamp = ts;
            }
            
            fs.appendFileSync(filePath, batchCsv);
            totalDownloaded += klines.length;
            
            process.stdout.write(`\r${symbol}: Downloaded ${totalDownloaded} candles...`);
            
            currentStartTime = lastTimestamp + INTERVAL_MS;
            await delay(50); // Be nice to Binance public API
            
        } catch (e: any) {
            console.error(`\nError fetching ${symbol}: ${e.message}. Retrying in 2 seconds...`);
            await delay(2000);
        }
    }
    
    console.log(`\nFinished ${symbol}: ${totalDownloaded} candles saved to ${filePath}`);
}

async function run() {
    for (const symbol of symbols) {
        await downloadSymbol(symbol);
    }
    console.log("All downloads complete!");
}

run().catch(console.error);
