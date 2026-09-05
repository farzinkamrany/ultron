const ccxt = require('ccxt');
(async () => {
  try {
    const ex = new ccxt.hyperliquid();
    await ex.loadMarkets();
    console.log(Object.keys(ex.markets).filter(s => s.includes('BTC')));
  } catch (err) {
    console.error(err);
  }
})();
