import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';

const INITIAL_CAPITAL = 1000;
const RISK_PERC = 0.01;
const MAKER_FEE = 0.0002;
const TAKER_FEE = 0.0005;
const SMC_LOOKBACK = 10;

async function runCompoundBacktest(symbol: string, timeframe: string, slBuffer: number) {
  const csvFile = `eth_${timeframe}_history.csv`;
  const filePath = path.join(process.cwd(), 'data', csvFile);
  if (!fs.existsSync(filePath)) {
    console.error(`Data file not found: ${csvFile}`);
    return;
  }

  let balance = INITIAL_CAPITAL;
  let activeTrade: any = null;
  const candles: any[] = [];
  let currentYear = 0;
  let year1Balance = 0;
  let year2Balance = 0;
  let totalTrades = 0;
  let wins = 0;
  let maxDrawdown = 0;
  let peakBalance = INITIAL_CAPITAL;

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isFirstLine = true;
  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; }
    if (!line.trim()) continue;
    const cols = line.split(',');
    if (cols.length < 6) continue;

    const timestamp = Number(cols[0]);
    const candleYear = new Date(timestamp).getUTCFullYear();

    if (currentYear !== 0 && currentYear !== candleYear && currentYear === 2021) {
      year1Balance = balance;
    }
    currentYear = candleYear;

    const candle = { timestamp, open: Number(cols[1]), high: Number(cols[2]), low: Number(cols[3]), close: Number(cols[4]), volume: Number(cols[5]) };
    candles.push(candle);
    if (candles.length > SMC_LOOKBACK + 5) candles.shift();
    if (candles.length < SMC_LOOKBACK) continue;

    const currentPrice = candle.close;
    if (balance <= 0) break;

    if (balance > peakBalance) peakBalance = balance;
    const dd = peakBalance - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (activeTrade) {
      let closed = false, pnl = 0, exitPrice = 0, isWin = false;
      const { entryPrice, sl, tp, action, pyramidStage, initialSl, riskAmount } = activeTrade;

      if (action === 'BUY') {
        if (candle.low <= sl) { exitPrice = sl; closed = true; }
        else if (pyramidStage === 0 && candle.high >= entryPrice + (tp - entryPrice) * 0.5) {
          activeTrade.sl = entryPrice; activeTrade.pyramidStage = 1;
        }
        else if (candle.high >= tp) { exitPrice = tp; closed = true; isWin = true; }
      } else {
        if (candle.high >= sl) { exitPrice = sl; closed = true; }
        else if (pyramidStage === 0 && candle.low <= entryPrice - (entryPrice - tp) * 0.5) {
          activeTrade.sl = entryPrice; activeTrade.pyramidStage = 1;
        }
        else if (candle.low <= tp) { exitPrice = tp; closed = true; isWin = true; }
      }

      if (closed) {
        const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
        const positionMultiplier = activeTrade.pyramidStage > 0 ? 2 : 1;
        const stopLossPerc = Math.abs(entryPrice - initialSl) / entryPrice;
        const positionSize = riskAmount / stopLossPerc;
        const rawPnl = positionSize * movePerc * positionMultiplier;
        const entryFee = positionSize * TAKER_FEE;
        const exitFee = (positionSize + Math.abs(rawPnl)) * (isWin ? MAKER_FEE : TAKER_FEE);
        balance += (rawPnl - entryFee - exitFee);
        totalTrades++;
        if (rawPnl > 0) wins++;
        activeTrade = null;
      }
      continue;
    }

    const { supports, resistances } = calculateGannSquareOf9(currentPrice);
    let closestSupport = 0, closestResistance = 0;
    for (const s of supports) if (currentPrice >= s) { closestSupport = s; break; }
    for (const r of resistances) if (r >= currentPrice) { closestResistance = r; break; }
    if (closestSupport === 0 || closestResistance === 0) continue;

    const distToSupp = (currentPrice - closestSupport) / currentPrice;
    const distToRes = (closestResistance - currentPrice) / currentPrice;
    let action = null, tp = 0, sl = 0;

    if (distToSupp <= slBuffer) {
      const longSL = closestSupport * (1 - slBuffer);
      const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - longSL) >= 2.0);
      if (validTP) { action = 'BUY'; tp = validTP; sl = longSL; }
    } else if (distToRes <= slBuffer) {
      const shortSL = closestResistance * (1 + slBuffer);
      const validTP = supports.find(s => (currentPrice - s) / (shortSL - currentPrice) >= 2.0);
      if (validTP) { action = 'SELL'; tp = validTP; sl = shortSL; }
    }

    if (action) {
      const obs = findOrderBlocks(candles);
      const isValid = action === 'BUY'
        ? !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity)
        : !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity);
      if (isValid) {
        activeTrade = { action, entryPrice: currentPrice, tp, sl, initialSl: sl, pyramidStage: 0, riskAmount: balance * RISK_PERC };
      }
    }
  }

  year2Balance = balance;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${symbol} - ${timeframe} TIMEFRAME COMPOUND BACKTEST (2021-2022)`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  سرمایه اولیه:          $${INITIAL_CAPITAL}`);
  console.log(`  پایان سال اول (2021):   $${year1Balance.toFixed(2)}`);
  console.log(`  پایان سال دوم (2022):   $${year2Balance.toFixed(2)}`);
  console.log(`  تعداد معاملات:          ${totalTrades}`);
  console.log(`  وین ریت:               ${totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0}%`);
  console.log(`  حداکثر افت سرمایه:      $${maxDrawdown.toFixed(2)}`);
  console.log(`${'='.repeat(50)}\n`);
}

async function main() {
  await runCompoundBacktest('ETH/USDT', '15m', 0.007);
  await runCompoundBacktest('ETH/USDT', '30m', 0.008);
  await runCompoundBacktest('ETH/USDT', '4h', 0.02);
}

main().catch(console.error);
