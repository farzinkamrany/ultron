import ccxt from 'ccxt';

async function testFetch() {
  try {
    const exchange = new ccxt.mexc();
    const ohlcv = await exchange.fetchOHLCV('BTC/USDT', '5m', undefined, 5);
    console.log("MEXC Success!", ohlcv.length);
  } catch (err: any) {
    console.error("MEXC Error:", err.message);
  }
}
testFetch();
