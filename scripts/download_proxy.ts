import fs from 'fs';

const symbol = 'LINKUSDT';
const timeframe = '15m'; 
const since = new Date('2020-01-01T00:00:00Z').getTime();
const until = new Date('2024-01-01T00:00:00Z').getTime();

async function fetchWithProxy(url: string) {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
}

async function download() {
    const filename = `data/link_15m_4years.csv`;
    
    console.log(`Downloading ${symbol} from Binance via Proxy...`);
    let currentSince = since;
    let allOhlcv: any[] = [];
    
    while (currentSince < until) {
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&startTime=${currentSince}&limit=1000`;
            const ohlcv = await fetchWithProxy(url);
            
            if (!Array.isArray(ohlcv) || ohlcv.length === 0) {
                currentSince += 7 * 24 * 60 * 60 * 1000; 
                continue;
            }
            
            allOhlcv.push(...ohlcv);
            currentSince = ohlcv[ohlcv.length - 1][0] + 1;
            
            process.stdout.write(`\r${symbol}: Downloaded ${allOhlcv.length} candles...`);
            
            if (ohlcv[ohlcv.length - 1][0] >= until) break;
            
            // Respect rate limits
            await new Promise(r => setTimeout(r, 500));
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
