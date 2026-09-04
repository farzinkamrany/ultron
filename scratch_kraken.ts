import ccxt from 'ccxt';

async function testFetch() {
  try {
    const exchange = new ccxt.kraken();
    const ohlcv = await exchange.fetchOHLCV('BTC/USDT', '5m', undefined, 5);
    console.log("Kraken Success!", ohlcv.length);
  } catch (err: any) {
    console.error("Kraken Error:", err.message);
  }
}
testFetch();
