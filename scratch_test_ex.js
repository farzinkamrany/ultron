const ccxt = require('ccxt');

async function testExchange(name) {
  try {
    const ex = new ccxt[name]({ enableRateLimit: true });
    // Try fetching a single candle to test connectivity
    await ex.fetchOHLCV('BTC/USDT', '1d', undefined, 1);
    console.log(`[SUCCESS] ${name} is accessible!`);
    return true;
  } catch (err) {
    console.log(`[FAILED] ${name}: ${err.message}`);
    return false;
  }
}

(async () => {
  const exchanges = ['bybit', 'okx', 'kraken', 'kucoin', 'mexc', 'huobi', 'gateio'];
  for (const ex of exchanges) {
    const success = await testExchange(ex);
    if (success) {
      console.log(`\nFound working exchange: ${ex}`);
      break;
    }
  }
})();
