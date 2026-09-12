import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { kmeans } from 'ml-kmeans';
import { calculateADX, calculateChoppinessIndex, Candle } from '../src/lib/trading/financial-intelligence';

async function fetchHistoricalData(): Promise<Candle[]> {
    console.log("Reading historical BTC/USDT data from local CSV...");
    const masterCsvPath = path.join(process.cwd(), 'data', 'btc_5m_history.csv');
    
    if (!fs.existsSync(masterCsvPath)) {
        throw new Error("Local CSV not found. Please run 'npm run fetch-history' first.");
    }
    
    const fileStream = fs.createReadStream(masterCsvPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    
    let allOhlcv: Candle[] = [];
    let isHeader = true;
    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        const parts = line.split(',');
        if (parts.length < 6) continue;
        
        allOhlcv.push({
            timestamp: parseInt(parts[0], 10),
            open: parseFloat(parts[1]),
            high: parseFloat(parts[2]),
            low: parseFloat(parts[3]),
            close: parseFloat(parts[4]),
            volume: parseFloat(parts[5])
        });
    }
    
    console.log(`Loaded ${allOhlcv.length} 5m candles.`);
    
    // Synthesize 1h candles (12 * 5m)
    console.log("Synthesizing 1h candles...");
    const hourly: Candle[] = [];
    for(let i=0; i<allOhlcv.length; i+=12) {
        const chunk = allOhlcv.slice(i, i+12);
        if(chunk.length === 0) continue;
        let high = -Infinity; let low = Infinity; let vol = 0;
        for (const c of chunk) {
            if (c.high > high) high = c.high;
            if (c.low < low) low = c.low;
            vol += c.volume;
        }
        hourly.push({
            timestamp: chunk[0].timestamp,
            open: chunk[0].open,
            high,
            low,
            close: chunk[chunk.length-1].close,
            volume: vol
        });
    }
    console.log(`Generated ${hourly.length} 1h candles.`);
    return hourly;
}

function extractFeatures(candles: Candle[]): { features: number[][], rawCandles: Candle[] } {
    console.log("Extracting features (ADX, CHOP, Volatility)...");
    const features: number[][] = [];
    const validCandles: Candle[] = [];
    
    for (let i = 110; i < candles.length; i++) {
        const window = candles.slice(0, i + 1);
        
        const chop = calculateChoppinessIndex(window, 14);
        const adx = calculateADX(window, 14);
        
        let shortATR = 0;
        for (let j = window.length - 14; j < window.length; j++) {
            const c = window[j], p = window[j - 1];
            shortATR += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        }
        shortATR /= 14;
        
        let baseATR = 0;
        const bStart = Math.max(1, window.length - 110);
        for (let j = bStart; j < bStart + 14; j++) {
            const c = window[j], p = window[j - 1];
            baseATR += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        }
        baseATR /= 14;
        
        const volRatio = baseATR > 0 ? shortATR / baseATR : 1;
        
        features.push([adx, chop, volRatio]);
        validCandles.push(candles[i]);
    }
    
    return { features, rawCandles: validCandles };
}

function normalizeFeatures(features: number[][]): { normalized: number[][], maxVals: number[], minVals: number[] } {
    const maxVals = [-Infinity, -Infinity, -Infinity];
    const minVals = [Infinity, Infinity, Infinity];
    
    for (const row of features) {
        for (let i = 0; i < 3; i++) {
            if (row[i] > maxVals[i]) maxVals[i] = row[i];
            if (row[i] < minVals[i]) minVals[i] = row[i];
        }
    }
    
    const normalized = features.map(row => {
        return [
            (row[0] - minVals[0]) / (maxVals[0] - minVals[0]),
            (row[1] - minVals[1]) / (maxVals[1] - minVals[1]),
            (row[2] - minVals[2]) / (maxVals[2] - minVals[2])
        ];
    });
    
    return { normalized, maxVals, minVals };
}

async function trainModel() {
    const candles = await fetchHistoricalData();
    const { features } = extractFeatures(candles);
    const { normalized, maxVals, minVals } = normalizeFeatures(features);
    
    console.log("Training K-Means model (k=4)...");
    const result = kmeans(normalized, 4, { initialization: 'kmeans++' });
    
    console.log("Clustering completed.");
    console.log("Raw Centroids:", result.centroids);
    
    const unnormalizedCentroids = result.centroids.map((c: number[]) => {
        // ml-kmeans returns either `{ centroid: [...] }` or just `[...]` depending on version
        const vec = Array.isArray(c) ? c : (c as any).centroid;
        return {
            adx: vec[0] * (maxVals[0] - minVals[0]) + minVals[0],
            chop: vec[1] * (maxVals[1] - minVals[1]) + minVals[1],
            volRatio: vec[2] * (maxVals[2] - minVals[2]) + minVals[2],
        }
    });
    
    console.log("Real-value Centroids:");
    unnormalizedCentroids.forEach((c: any, i: number) => {
        console.log(`Cluster ${i}: ADX=${c.adx.toFixed(2)}, CHOP=${c.chop.toFixed(2)}, VolRatio=${c.volRatio.toFixed(2)}`);
    });
    
    let labels: string[] = ["", "", "", ""];
    
    let highVolIdx = 0; let maxVol = -Infinity;
    unnormalizedCentroids.forEach((c: any, i: number) => { if (c.volRatio > maxVol) { maxVol = c.volRatio; highVolIdx = i; } });
    labels[highVolIdx] = "HIGH_VOL";
    
    let maxChop = -Infinity; let rangingIdx = -1;
    unnormalizedCentroids.forEach((c: any, i: number) => { 
        if (i !== highVolIdx && c.chop > maxChop) { maxChop = c.chop; rangingIdx = i; } 
    });
    labels[rangingIdx] = "RANGING";
    
    let maxAdx = -Infinity; let trendingIdx = -1;
    unnormalizedCentroids.forEach((c: any, i: number) => { 
        if (i !== highVolIdx && i !== rangingIdx && c.adx > maxAdx) { maxAdx = c.adx; trendingIdx = i; } 
    });
    labels[trendingIdx] = "TRENDING";
    
    let normalIdx = labels.findIndex(l => l === "");
    labels[normalIdx] = "NORMAL";
    
    const finalModel = {
        centroids: result.centroids.map((c: any) => Array.isArray(c) ? c : c.centroid),
        labels,
        normalization: { maxVals, minVals }
    };
    
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    
    const outPath = path.join(dataDir, 'regime_centroids.json');
    fs.writeFileSync(outPath, JSON.stringify(finalModel, null, 2));
    
    console.log(`\nModel saved to ${outPath}`);
    labels.forEach((l, i) => console.log(`Cluster ${i} mapped to ${l}`));
}

trainModel().catch(console.error);
