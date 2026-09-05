const ccxt = require('ccxt');

async function test() {
  const exchange = new ccxt.hyperliquid({ enableRateLimit: true, options: { defaultType: 'swap' } });
  
  try {
    const symbols = ['BTC/USDC:USDC', 'ETH/USDC:USDC'];
    console.log("Fetching tickers for:", symbols);
    const tickers = await exchange.fetchTickers(symbols);
    for (const sym of symbols) {
      if (tickers[sym]) {
        console.log(`[OK] ${sym} -> Last Price: ${tickers[sym].last}`);
      } else {
        console.log(`[FAIL] No data for ${sym}`);
      }
    }
  } catch (err) {
    console.error("Error fetching tickers:", err.message);
  }
}

test();
