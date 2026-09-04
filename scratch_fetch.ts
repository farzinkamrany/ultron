import ccxt from 'ccxt';

async function testFetch() {
  try {
    const exchange = new ccxt.coinex();
    const ohlcv = await exchange.fetchOHLCV('BTC/USDT', '5m', undefined, 5);
    console.log("CoinEx Success!", ohlcv.length);
  } catch (err: any) {
    console.error("CoinEx Error:", err.message);
  }

  try {
    const exchange = new ccxt.kucoin();
    const ohlcv = await exchange.fetchOHLCV('BTC/USDT', '5m', undefined, 5);
    console.log("Kucoin Success!", ohlcv.length);
  } catch (err: any) {
    console.error("Kucoin Error:", err.message);
  }
}
testFetch();
