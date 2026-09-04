import fetch from 'node-fetch';

async function testVision() {
  try {
    const url = 'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/5m/BTCUSDT-5m-2021-01.zip';
    const res = await fetch(url);
    console.log("Binance Vision Status:", res.status);
  } catch (err: any) {
    console.error("Vision Error:", err.message);
  }
}
testVision();
