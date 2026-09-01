require('dotenv').config({ path: '.env.local' });
const ccxt = require('ccxt');
const { HttpsProxyAgent } = require('https-proxy-agent');

async function test() {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  console.log("Proxy URL:", proxyUrl);
  
  const exchange = new ccxt.binance({ enableRateLimit: true });
  if (proxyUrl) {
    // Test if this works
    exchange.agent = new HttpsProxyAgent(proxyUrl);
  }

  try {
    console.log("Fetching BTC/USDT...");
    const ticker = await exchange.fetchTicker("BTC/USDT");
    console.log("Success! Last price:", ticker.last);
  } catch (err) {
    console.error("CCXT Error:", err.message);
  }
}

test();
