import fetch from 'node-fetch';

async function testCorsProxy() {
  try {
    const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=5';
    const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
    const res = await fetch(proxyUrl);
    const data = await res.json();
    console.log("CORS Proxy Success!", data.length);
  } catch (err: any) {
    console.error("CORS Proxy Error:", err.message);
  }
}
testCorsProxy();
