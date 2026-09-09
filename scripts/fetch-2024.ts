import fs from 'fs/promises';
import path from 'path';

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const INTERVAL = '1h';
const CHUNK_DAYS = 20;
const REQUEST_DELAY_MS = 150;
const ASSETS = ['BTC', 'ETH', 'SOL', 'LINK', 'ADA', 'BNB', 'XRP', 'DOGE', 'AVAX', 'DOT'];

interface HyperliquidCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function postInfo<T>(body: unknown): Promise<T> {
  const response = await fetch(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Hyperliquid API returned ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function fetchCandles(coin: string, startTime: number, endTime: number) {
  const candles = await postInfo<HyperliquidCandle[]>({
    type: 'candleSnapshot',
    req: { coin, interval: INTERVAL, startTime, endTime },
  });

  return candles.map((candle) => [
    candle.t,
    Number(candle.o),
    Number(candle.h),
    Number(candle.l),
    Number(candle.c),
    Number(candle.v),
  ]);
}

async function fetchCoinHistory(coin: string, startTime: number, endTime: number) {
  const candlesByTimestamp = new Map<number, number[]>();
  const chunkMilliseconds = CHUNK_DAYS * 24 * 60 * 60 * 1000;

  for (let chunkStart = startTime; chunkStart < endTime; chunkStart += chunkMilliseconds) {
    const chunkEnd = Math.min(chunkStart + chunkMilliseconds, endTime);
    const candles = await fetchCandles(coin, chunkStart, chunkEnd);
    for (const candle of candles) candlesByTimestamp.set(candle[0], candle);
    await sleep(REQUEST_DELAY_MS);
  }

  return [...candlesByTimestamp.values()].sort((first, second) => first[0] - second[0]);
}

async function main() {
  const outputDirectory = path.join(process.cwd(), 'data');
  const endTime = Date.now();
  const startTime = new Date('2024-01-01T00:00:00Z').getTime();
  await fs.mkdir(outputDirectory, { recursive: true });

  for (const coin of ASSETS) {
    process.stdout.write(`Fetching ${coin} since Jan 2024... `);
    try {
      const candles = await fetchCoinHistory(coin, startTime, endTime);
      const fileName = `${coin.toLowerCase()}_1h_history.csv`;
      const csv = ['timestamp,open,high,low,close,volume', ...candles.map((candle) => candle.join(','))].join('\n');
      await fs.writeFile(path.join(outputDirectory, fileName), csv, 'utf8');
      console.log(`${candles.length} candles saved.`);
    } catch (error) {
      console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
