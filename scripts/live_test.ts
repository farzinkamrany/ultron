import ccxt from 'ccxt';
import { evaluateSetup } from '../src/lib/trading/strategy';
import { detectRegime } from '../src/lib/trading/financial-intelligence';
import { getTopVolatileSymbols } from '../src/lib/trading/screener';

async function runLiveTest() {
    console.log("==========================================");
    console.log("   ULTRON V18.0 - LIVE MARKET DRY RUN");
    console.log("==========================================\n");
    
    console.log("[1] Scanning for Top 10 Volatile Assets...");
    const symbols = await getTopVolatileSymbols();
    console.log(`[+] Selected Assets: ${symbols.join(', ')}\n`);
    
    const exchange = new ccxt.kraken({ enableRateLimit: true });
    
    console.log("[2] Analyzing Live Data & Regimes...");
    
    for (const symbol of symbols) {
        try {
            const ohlcv15m = await exchange.fetchOHLCV(symbol, "15m", undefined, 20);
            const ohlcv1h = await exchange.fetchOHLCV(symbol, "1h", undefined, 365);
            
            const mapCandles = (ohlcv: any[]) => ohlcv.map(c => ({
                timestamp: c[0] as number,
                open: c[1] as number,
                high: c[2] as number,
                low: c[3] as number,
                close: c[4] as number,
                volume: c[5] as number,
            }));
            
            const candles15m = mapCandles(ohlcv15m);
            const candles1h = mapCandles(ohlcv1h);
            const livePrice = candles15m[candles15m.length - 1].close;
            
            const regime = detectRegime(candles1h);
            
            const signal = await evaluateSetup(symbol, livePrice, candles15m, candles1h, regime);
            
            let statusStr = `[${symbol}] Price: $${livePrice} | Regime: ${regime.padEnd(8)} | Signal: `;
            
            if (signal.action === 'HOLD') {
                statusStr += `🟡 HOLD (${signal.reason})`;
            } else if (signal.action === 'BUY') {
                statusStr += `🟢 BUY  | TP: $${signal.takeProfit.toFixed(4)} | SL: $${signal.stopLoss.toFixed(4)} | (${signal.reason})`;
            } else if (signal.action === 'SELL') {
                statusStr += `🔴 SELL | TP: $${signal.takeProfit.toFixed(4)} | SL: $${signal.stopLoss.toFixed(4)} | (${signal.reason})`;
            }
            
            console.log(statusStr);
            
        } catch (e: any) {
            console.log(`[${symbol}] Error fetching data: ${e.message}`);
        }
    }
    console.log("\n==========================================");
    console.log("   DRY RUN COMPLETE");
    console.log("==========================================");
}

runLiveTest().catch(console.error);
