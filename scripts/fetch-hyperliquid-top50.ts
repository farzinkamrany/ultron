import fs from 'fs/promises';
import path from 'path';

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false';
const INTERVAL = '15m';
const LOOKBACK_DAYS = 183;
const CHUNK_DAYS = 20;
const REQUEST_DELAY_MS = 150;
const STABLECOINS = new Set([
  'USDT', 'USDC', 'USDE', 'DAI', 'USDS', 'USD1', 'FDUSD', 'PYUSD', 'TUSD',
  'USDD', 'FRAX', 'USDP', 'GHO', 'LUSD', 'BUSD', 'USDX', 'USDB',
]);

interface CoinGeckoMarket {
  symbol: string;
  name: string;
  market_cap_rank: number | null;
}

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

async function getEligibleCoins(): Promise<{ coin: string; rank: number; name: string }[]> {
  const [marketsResponse, metadata] = await Promise.all([
    fetch(COINGECKO_MARKETS_URL),
    postInfo<{ universe: { name: string }[] }>({ type: 'meta' }),
  ]);

  if (!marketsResponse.ok) {
    throw new Error(`CoinGecko returned ${marketsResponse.status}: ${await marketsResponse.text()}`);
  }

  const markets = await marketsResponse.json() as CoinGeckoMarket[];
  const hyperliquidCoins = new Set(metadata.universe.map((market) => market.name.toUpperCase()));

  return markets
    .filter((market) => market.market_cap_rank !== null)
    .filter((market) => !STABLECOINS.has(market.symbol.toUpperCase()))
    .slice(0, 50)
    .filter((market) => hyperliquidCoins.has(market.symbol.toUpperCase()))
    .map((market) => ({
      coin: market.symbol.toUpperCase(),
      rank: market.market_cap_rank!,
      name: market.name,
    }));
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
  const outputDirectory = path.join(process.cwd(), 'data', 'hyperliquid-15m-6months');
  const endTime = Date.now();
  const startTime = endTime - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  await fs.mkdir(outputDirectory, { recursive: true });

  const eligibleCoins = await getEligibleCoins();
  console.log(`Found ${eligibleCoins.length} Hyperliquid perps in the market-cap Top 50.`);

  const manifest: { coin: string; name: string; marketCapRank: number; candles: number; file: string }[] = [];
  for (const { coin, rank, name } of eligibleCoins) {
    process.stdout.write(`Fetching ${coin} (#${rank})... `);
    try {
      const candles = await fetchCoinHistory(coin, startTime, endTime);
      const fileName = `${coin.toLowerCase()}_15m_hyperliquid_6months.csv`;
      const csv = ['timestamp,open,high,low,close,volume', ...candles.map((candle) => candle.join(','))].join('\n');
      await fs.writeFile(path.join(outputDirectory, fileName), csv, 'utf8');
      manifest.push({ coin, name, marketCapRank: rank, candles: candles.length, file: fileName });
      console.log(`${candles.length} candles`);
    } catch (error) {
      console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await fs.writeFile(
    path.join(outputDirectory, 'manifest.json'),
    JSON.stringify({ interval: INTERVAL, startTime, endTime, markets: manifest }, null, 2),
    'utf8',
  );
  console.log(`Saved ${manifest.length} market histories to ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});