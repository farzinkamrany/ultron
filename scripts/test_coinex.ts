import ccxt from 'ccxt';
import fs from 'fs';

const exchange = new ccxt.coinex({
    enableRateLimit: true,
});

async function test() {
    try {
        console.log("Testing Coinex...");
        const ohlcv = await exchange.fetchOHLCV('ADA/USDT', '15m', undefined, 10);
        console.log("Success! Data length:", ohlcv.length);
    } catch (e: any) {
        console.error("Coinex Failed:", e.message);
    }
}

test();
