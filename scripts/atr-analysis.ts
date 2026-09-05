import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';

const SL_BUFFER = 0.006;
const ATR_PERIOD = 14;
const ATR_BUCKET_SIZE = 500;
const SMC_LOOKBACK = 10;

interface TradeResult {
  won: boolean;
  atr: number;
  year: number;
  month: number;
}

async function runATRAnalysis() {
  const filePath = path.join(process.cwd(), 'data', 'btc_15m_4years.csv');
  if (!fs.existsSync(filePath)) {
    console.error("Historical CSV not found: data/btc_15m_4years.csv");
    return;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const candles: any[] = [];
  let isFirstLine = true;

  console.log("Loading candles...");

  await new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      if (isFirstLine) { isFirstLine = false; return; }
      const parts = line.split(',');
      if (parts.length < 6) return;
      const [ts, open, high, low, close, volume] = parts.map(Number);
      if (isNaN(ts) || isNaN(close)) return;
      candles.push({ timestamp: ts, open, high, low, close, volume });
    });
    rl.on('close', resolve);
  });

  console.log(`Loaded ${candles.length} candles. Running ATR analysis...`);

  const tradeResults: TradeResult[] = [];
  let activeTrade: any = null;

  for (let i = ATR_PERIOD * 96 + SMC_LOOKBACK; i < candles.length; i++) {
    const candle = candles[i];

    // --- Calculate Daily ATR for last 14 days ---
    // Use 96 candles = 1 day on 15m chart
    const dailyCandles: { high: number, low: number, close: number }[] = [];
    for (let d = 0; d < ATR_PERIOD + 1; d++) {
      const startIdx = i - (ATR_PERIOD - d) * 96;
      if (startIdx < 0) continue;
      // Take the high/low/close for that day's worth of candles
      const daySlice = candles.slice(startIdx, startIdx + 96);
      if (daySlice.length === 0) continue;
      const dayHigh = Math.max(...daySlice.map((c: any) => c.high));
      const dayLow = Math.min(...daySlice.map((c: any) => c.low));
      const dayClose = daySlice[daySlice.length - 1].close;
      dailyCandles.push({ high: dayHigh, low: dayLow, close: dayClose });
    }

    let totalTR = 0;
    for (let d = 1; d < dailyCandles.length; d++) {
      const tr = Math.max(
        dailyCandles[d].high - dailyCandles[d].low,
        Math.abs(dailyCandles[d].high - dailyCandles[d - 1].close),
        Math.abs(dailyCandles[d].low - dailyCandles[d - 1].close)
      );
      totalTR += tr;
    }
    const currentATR = totalTR / ATR_PERIOD;

    // --- Check active trade ---
    if (activeTrade) {
      const won = activeTrade.type === 'LONG'
        ? candle.high >= activeTrade.tp || candle.low <= activeTrade.sl
          ? candle.high >= activeTrade.tp
          : null
        : candle.low <= activeTrade.tp || candle.high >= activeTrade.sl
          ? candle.low <= activeTrade.tp
          : null;

      if (won !== null) {
        const date = new Date(candle.timestamp);
        tradeResults.push({
          won,
          atr: activeTrade.atr,
          year: date.getFullYear(),
          month: date.getMonth() + 1,
        });
        activeTrade = null;
      }
      continue; // One trade at a time
    }

    // --- Signal Detection ---
    const recent = candles.slice(i - SMC_LOOKBACK, i);
    const gann = calculateGannSquareOf9(candle.close);
    const orderBlocks = findOrderBlocks(recent);

    const closestSupport = gann.supports
      .filter((s: number) => s < candle.close)
      .sort((a: number, b: number) => b - a)[0];
    const closestResistance = gann.resistances
      .filter((r: number) => r > candle.close)
      .sort((a: number, b: number) => a - b)[0];

    if (!closestSupport || !closestResistance) continue;

    const bullOB = orderBlocks.find((ob: any) =>
      ob.type === 'bullish' && ob.swept &&
      Math.abs(ob.high - closestSupport) / closestSupport < SL_BUFFER
    );

    const bearOB = orderBlocks.find((ob: any) =>
      ob.type === 'bearish' && ob.swept &&
      Math.abs(ob.low - closestResistance) / closestResistance < SL_BUFFER
    );

    if (bullOB) {
      const sl = closestSupport * (1 - SL_BUFFER);
      const tp = closestResistance;
      const rr = (tp - candle.close) / (candle.close - sl);
      if (rr >= 2) {
        activeTrade = { type: 'LONG', sl, tp, atr: currentATR };
      }
    } else if (bearOB) {
      const sl = closestResistance * (1 + SL_BUFFER);
      const tp = closestSupport;
      const rr = (candle.close - tp) / (sl - candle.close);
      if (rr >= 2) {
        activeTrade = { type: 'SHORT', sl, tp, atr: currentATR };
      }
    }
  }

  // --- Bucket Analysis ---
  console.log(`\nTotal trades analyzed: ${tradeResults.length}`);
  console.log("\n============================================================");
  console.log("     ATR REGIME ANALYSIS — BTC/USDT 15m (4 Years)");
  console.log("============================================================");

  // Group by ATR bucket
  const buckets: { [key: string]: { wins: number, total: number } } = {};

  for (const t of tradeResults) {
    const bucket = Math.floor(t.atr / ATR_BUCKET_SIZE) * ATR_BUCKET_SIZE;
    const key = `$${bucket}-$${bucket + ATR_BUCKET_SIZE}`;
    if (!buckets[key]) buckets[key] = { wins: 0, total: 0 };
    buckets[key].total++;
    if (t.won) buckets[key].wins++;
  }

  const sortedBuckets = Object.entries(buckets).sort((a, b) => {
    const aVal = parseInt(a[0].replace('$', ''));
    const bVal = parseInt(b[0].replace('$', ''));
    return aVal - bVal;
  });

  console.log("\n📊 Win Rate by ATR Range (Daily ATR in USD):\n");
  console.log("ATR Range          | Trades | Win Rate | Verdict");
  console.log("-------------------|--------|----------|---------");

  let optimalThresholdLow = 0;
  let optimalThresholdHigh = 0;
  let maxWinRate = 0;

  for (const [range, data] of sortedBuckets) {
    const winRate = (data.wins / data.total * 100).toFixed(1);
    const wr = parseFloat(winRate);
    let verdict = '';
    if (wr >= 22) { verdict = '🟢 OPTIMAL (1.5% risk)'; if (wr > maxWinRate) { maxWinRate = wr; optimalThresholdHigh = parseInt(range.split('-')[1].replace('$', '')); }}
    else if (wr >= 18) { verdict = '🟡 CALM (1% risk)'; }
    else { verdict = '🔴 WILD (0.5% risk)'; }
    console.log(`${range.padEnd(18)} | ${String(data.total).padEnd(6)} | ${winRate.padEnd(8)}% | ${verdict}`);
  }

  // Monthly seasonality
  console.log("\n============================================================");
  console.log("     MONTHLY SEASONALITY (Win Rate by Month)");
  console.log("============================================================\n");

  const monthly: { [key: number]: { wins: number, total: number } } = {};
  for (const t of tradeResults) {
    if (!monthly[t.month]) monthly[t.month] = { wins: 0, total: 0 };
    monthly[t.month].total++;
    if (t.won) monthly[t.month].wins++;
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  console.log("Month | Trades | Win Rate | Risk Recommendation");
  console.log("------|--------|----------|--------------------");

  for (let m = 1; m <= 12; m++) {
    const d = monthly[m];
    if (!d) continue;
    const wr = (d.wins / d.total * 100);
    const rec = wr >= 22 ? '🟢 1.5% risk' : wr >= 18 ? '🟡 1% risk' : '🔴 0.5% risk';
    console.log(`${monthNames[m-1].padEnd(5)} | ${String(d.total).padEnd(6)} | ${wr.toFixed(1).padEnd(8)}% | ${rec}`);
  }

  console.log("\n============================================================");
  console.log("✅ Analysis Complete");
  console.log("============================================================\n");
}

runATRAnalysis().catch(console.error);
