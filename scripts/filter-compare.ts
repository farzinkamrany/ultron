import * as fs from 'fs';
import * as readline from 'readline';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { detectSqueeze, calculateChoppinessIndex, detectCapitulation, checkEarlyExit, detectRegime } from '../src/lib/trading/financial-intelligence';

interface MultiCandle {
    symbol: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const INITIAL_CAPITAL = 1000;
const MAX_LOSS_LIMIT = 900;
const MAKER_FEE = 0.0012;
const HARD_POSITION_CAP = 50000;

// ── FILTER DEFINITIONS ────────────────────────────────────────

function isWeekend(ts: number): boolean {
    const d = new Date(ts).getUTCDay();
    return d === 0 || d === 6;
}

function weekendFilter(symbol: string, rr: number, ts: number): boolean {
    if (!isWeekend(ts)) return true;
    const allowed = ['BTC', 'ETH', 'SOL'];
    return allowed.includes(symbol) && rr >= 5;
}

function makeCooldownFilter() {
    const cooldowns: Record<string, number> = {};
    return {
        isBlocked(symbol: string, ts: number): boolean {
            return (cooldowns[symbol] ?? 0) > ts;
        },
        onLoss(symbol: string, ts: number) {
            cooldowns[symbol] = ts + 6 * 15 * 60 * 1000; // 6 candles × 15m
        }
    };
}

// ── HELPERS ──────────────────────────────────────────────────

function calculateATR(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < 2) return 0;
    const p = Math.min(period, candles.length - 1);
    let sum = 0;
    for (let i = candles.length - p; i < candles.length; i++) {
        sum += Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i-1].close),
            Math.abs(candles[i].low  - candles[i-1].close)
        );
    }
    return sum / p;
}

function calculateEMA(candles: MultiCandle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;
    const k = 2 / (period + 1);
    let ema = 0;
    for (let i = 0; i < period; i++) ema += candles[i].close;
    ema /= period;
    for (let i = period; i < candles.length; i++) ema = (candles[i].close - ema) * k + ema;
    return ema;
}

function calculateRSI(candles: MultiCandle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const ch = candles[i].close - candles[i-1].close;
        if (ch > 0) gains += ch; else losses -= ch;
    }
    const rs = (gains / period) / ((losses / period) || 0.0001);
    return 100 - (100 / (1 + rs));
}

async function loadCSV(filePath: string, symbol: string): Promise<MultiCandle[]> {
    if (!fs.existsSync(filePath)) { console.warn(`⚠️  Missing: ${filePath}`); return []; }
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    const data: MultiCandle[] = [];
    let isHeader = true;
    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        const [ts, open, high, low, close, volume] = line.split(',');
        data.push({ symbol, timestamp: parseInt(ts), open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close), volume: parseFloat(volume) });
    }
    return data;
}

// ── CORE BACKTEST RUNNER ──────────────────────────────────────

async function runScenario(
    label: string,
    globalTimeline: MultiCandle[],
    useWeekendFilter: boolean,
    useCooldown: boolean
) {
    const cooldown = makeCooldownFilter();

    let balance = INITIAL_CAPITAL;
    let skipped = 0;
    let consecutiveLosses = 0;
    let circuitBreakerActive = false;

    const stats = {
        totalTrades: 0, wins: 0, losses: 0,
        totalFeesPaid: 0, grossProfit: 0, grossLoss: 0,
        maxDrawdown: 0, maxDrawdownPercent: 0,
        peakBalance: INITIAL_CAPITAL,
        periods: {} as Record<string, { trades: number, wins: number, pnl: number }>,
        symbolStats: {} as Record<string, { trades: number, pnl: number }>
    };

    const activeTrades: Record<string, any> = {};
    const lastTradeClosedTime: Record<string, number> = {};
    const buffers: Record<string, MultiCandle[]> = {};

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        const { symbol, timestamp, high, low, close: currentPrice } = candle;

        if (!buffers[symbol]) buffers[symbol] = [];
        buffers[symbol].push(candle);
        if (buffers[symbol].length > 1500) buffers[symbol].shift();
        const candles = buffers[symbol];
        if (candles.length < 1500) continue;

        // ── TRADE MANAGEMENT ─────────────────────────────────
        let activeTrade = activeTrades[symbol];
        if (activeTrade) {
            if (balance > stats.peakBalance) stats.peakBalance = balance;
            const dd = stats.peakBalance - balance;
            if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
            const ddPct = (dd / stats.peakBalance) * 100;
            if (ddPct > stats.maxDrawdownPercent) stats.maxDrawdownPercent = ddPct;

            const { entryPrice, tp, action, pyramidStage, initialSl } = activeTrade;
            const atr = calculateATR(candles, 14);
            const chandelierLong = currentPrice - (atr * 2);
            const chandelierShort = currentPrice + (atr * 2);

            let closed = false, exitPrice = 0;

            if (action === 'BUY') {
                const earlyExit = checkEarlyExit(activeTrade, candles);
                if (earlyExit) { exitPrice = currentPrice; closed = true; }
                else if (candle.low <= activeTrade.sl) { exitPrice = activeTrade.sl * 0.999; closed = true; }
                else if (pyramidStage === 0 && candle.high >= tp) { activeTrade.pyramidStage = 1; }
                if (pyramidStage > 0) {
                    activeTrade.sl = Math.max(activeTrade.sl, chandelierLong);
                    if (candle.low <= activeTrade.sl) { exitPrice = activeTrade.sl; closed = true; }
                }
            } else {
                const earlyExit = checkEarlyExit(activeTrade, candles);
                if (earlyExit) { exitPrice = currentPrice; closed = true; }
                else if (candle.high >= activeTrade.sl) { exitPrice = activeTrade.sl * 1.001; closed = true; }
                else if (pyramidStage === 0 && candle.low <= tp) { activeTrade.pyramidStage = 1; }
                if (pyramidStage > 0) {
                    activeTrade.sl = Math.min(activeTrade.sl, chandelierShort);
                    if (candle.high >= activeTrade.sl) { exitPrice = activeTrade.sl; closed = true; }
                }
            }

            if (closed) {
                const baseRisk = 0.005;
                const leverage = 10;
                let risk = baseRisk;
                if (stats.totalTrades > 50) {
                    const W = stats.wins / stats.totalTrades;
                    const R = stats.wins > 0 && stats.losses > 0 ? (stats.grossProfit / stats.wins) / (stats.grossLoss / stats.losses) : 1;
                    const kelly = W - (1 - W) / Math.max(R, 1);
                    if (kelly > 0) risk = Math.max(baseRisk, Math.min(0.01, kelly * 0.25));
                }
                if (activeTrade.isChoppy) risk *= 0.5;

                let posSize = (activeTrade.balanceAtEntry * risk) / (Math.abs(entryPrice - initialSl) / entryPrice);
                posSize = Math.min(posSize, activeTrade.balanceAtEntry * leverage, HARD_POSITION_CAP);

                const movePerc = action === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
                const units = pyramidStage > 0 ? 2 : 1;
                let rawPnl = posSize * units * movePerc;

                // Gap slippage
                if (action === 'BUY' && candle.low < activeTrade.sl * 0.98) rawPnl -= posSize * 0.015;
                if (action === 'SELL' && candle.high > activeTrade.sl * 1.02) rawPnl -= posSize * 0.015;

                const holdCandles = (timestamp - activeTrade.entryTime) / (1000 * 60 * 15);
                const funding = Math.floor(holdCandles / 32) * (posSize * units * 0.0001);
                const fees = (posSize * units * MAKER_FEE) * 2;
                const pnl = rawPnl - fees - funding;

                balance += pnl;
                stats.totalFeesPaid += fees;
                stats.totalTrades++;

                if (!stats.symbolStats[symbol]) stats.symbolStats[symbol] = { trades: 0, pnl: 0 };
                stats.symbolStats[symbol].trades++;
                stats.symbolStats[symbol].pnl += pnl;

                const period = `${new Date(timestamp).getFullYear()}-${new Date(timestamp).getMonth() < 6 ? 'H1' : 'H2'}`;
                if (!stats.periods[period]) stats.periods[period] = { trades: 0, wins: 0, pnl: 0 };
                stats.periods[period].trades++;
                stats.periods[period].pnl += pnl;

                if (rawPnl > 0) {
                    stats.wins++; stats.grossProfit += rawPnl;
                    consecutiveLosses = 0;
                    stats.periods[period].wins++;
                } else {
                    stats.losses++; stats.grossLoss += Math.abs(rawPnl);
                    consecutiveLosses++;
                    if (consecutiveLosses >= 3) circuitBreakerActive = true;
                    // ── COOLDOWN FILTER ──
                    if (useCooldown) cooldown.onLoss(symbol, timestamp);
                }

                if (balance <= INITIAL_CAPITAL - MAX_LOSS_LIMIT) {
                    console.log(`[${label}] 💥 Max loss hit at ${new Date(timestamp).toISOString()}!`);
                    break;
                }

                lastTradeClosedTime[symbol] = timestamp;
                delete activeTrades[symbol];
            }
            continue;
        }

        // ── ENTRY LOGIC ───────────────────────────────────────
        const regime = detectRegime(candles);
        const maxConcurrent = regime === 'TRENDING' ? 8 : 3;
        if (Object.keys(activeTrades).length >= maxConcurrent) continue;

        if (circuitBreakerActive) {
            const chop = calculateChoppinessIndex(candles, 288);
            if (chop < 50) { circuitBreakerActive = false; consecutiveLosses = 0; }
            else continue;
        }

        const lastClose = lastTradeClosedTime[symbol] || 0;
        if (timestamp - lastClose < 15 * 60 * 1000) continue;

        const gann = calculateGannSquareOf9(currentPrice);
        const supports = gann.supports.sort((a, b) => b - a);
        const resistances = gann.resistances.sort((a, b) => a - b);
        if (!supports.length || !resistances.length) continue;

        const closestSupport = supports[0];
        const closestResistance = resistances[0];
        const distToSup = (currentPrice - closestSupport) / currentPrice;
        const distToRes = (closestResistance - currentPrice) / currentPrice;

        const atr = calculateATR(candles);
        let dynSL = Math.max((atr / currentPrice) * 1.5, 0.003);

        let action = '', tp = 0, sl = 0;

        const cap = await detectCapitulation(candles, symbol, 200);
        if (cap === 'BULLISH') { action = 'BUY'; sl = currentPrice * (1 - dynSL); tp = currentPrice * (1 + dynSL * 5); }
        else if (cap === 'BEARISH') { action = 'SELL'; sl = currentPrice * (1 + dynSL); tp = currentPrice * (1 - dynSL * 5); }

        if (!action) {
            if (regime === 'RANGING') {
                if (distToSup <= dynSL) {
                    const vtp = resistances.find(r => r > currentPrice);
                    if (vtp && (vtp - currentPrice) / (currentPrice - closestSupport * (1 - dynSL)) >= 1.0) { action = 'BUY'; tp = vtp; sl = closestSupport * (1 - dynSL); }
                } else if (distToRes <= dynSL) {
                    const vtp = supports.find(s => s < currentPrice);
                    if (vtp && (currentPrice - vtp) / (closestResistance * (1 + dynSL) - currentPrice) >= 1.0) { action = 'SELL'; tp = vtp; sl = closestResistance * (1 + dynSL); }
                }
            } else {
                if (distToSup <= dynSL) {
                    const vtp = resistances.find(r => (r - currentPrice) / (currentPrice - closestSupport * (1 - dynSL)) >= 1.5);
                    if (vtp) { action = 'BUY'; tp = vtp; sl = closestSupport * (1 - dynSL); }
                } else if (distToRes <= dynSL) {
                    const vtp = supports.find(s => (currentPrice - s) / (closestResistance * (1 + dynSL) - currentPrice) >= 1.5);
                    if (vtp) { action = 'SELL'; tp = vtp; sl = closestResistance * (1 + dynSL); }
                }
            }
        }

        if (action && candles.length >= 800) {
            const macroEma = calculateEMA(candles, 800);
            const weeklyEma = calculateEMA(candles, 672);
            const rsi = calculateRSI(candles, 14);
            let volSum = 0;
            for (let v = candles.length - 20; v < candles.length; v++) volSum += candles[v].volume;
            const volSpike = candle.volume > (volSum / 20) * 3;
            const override = (action === 'BUY' && rsi < 25 && volSpike) || (action === 'SELL' && rsi > 75 && volSpike);
            if (!override) {
                if (action === 'BUY' && (currentPrice < macroEma || currentPrice < weeklyEma)) action = '';
                if (action === 'SELL' && (currentPrice > macroEma || currentPrice > weeklyEma)) action = '';
            }
        }

        if (!action) continue;

        // ── APPLY FILTERS ─────────────────────────────────────
        const rr = sl > 0 ? Math.abs(tp - currentPrice) / Math.abs(currentPrice - sl) : 0;

        if (useCooldown && cooldown.isBlocked(symbol, timestamp)) { skipped++; continue; }
        if (useWeekendFilter && !weekendFilter(symbol, rr, timestamp)) { skipped++; continue; }

        let buyCount = 0, sellCount = 0;
        for (const tr of Object.values(activeTrades)) {
            if (tr.action === 'BUY') buyCount++; else sellCount++;
        }
        if (action === 'BUY' && buyCount >= 2) continue;
        if (action === 'SELL' && sellCount >= 2) continue;

        const chop = calculateChoppinessIndex(candles, 288);
        activeTrades[symbol] = {
            symbol, action,
            entryPrice: currentPrice, entryTime: timestamp,
            sl, initialSl: sl, tp,
            pyramidStage: 0,
            balanceAtEntry: balance,
            isChoppy: chop > 50,
            isSqueezeAccelerated: detectSqueeze(candles)
        };
    }

    return { label, balance, stats, skipped };
}

// ── MAIN ──────────────────────────────────────────────────────

async function main() {
    console.log('Loading CSV data...');
    // Using *_4years CSV files — faster than full history
    const [btc, eth, sol, link, ada, bnb, xrp, doge, avax, dot] = await Promise.all([
        loadCSV('data/btc_15m_4years.csv',  'BTC'),
        loadCSV('data/eth_15m_4years.csv',  'ETH'),
        loadCSV('data/sol_15m_3years.csv',  'SOL'),   // SOL 4years is empty
        loadCSV('data/link_15m_4years.csv', 'LINK'),
        loadCSV('data/ada_15m_4years.csv',  'ADA'),
        loadCSV('data/bnb_15m_4years.csv',  'BNB'),
        loadCSV('data/xrp_15m_4years.csv',  'XRP'),
        loadCSV('data/doge_15m_4years.csv', 'DOGE'),
        loadCSV('data/avax_15m_4years.csv', 'AVAX'),
        loadCSV('data/dot_15m_4years.csv',  'DOT'),
    ]);

    const START = 1640995200000; // Jan 1, 2022 — match 4-year files
    const priority: Record<string, number> = { SOL: 1, ETH: 2, BTC: 3, LINK: 4, DOGE: 5 };
    const timeline = [...btc, ...eth, ...sol, ...link, ...ada, ...bnb, ...xrp, ...doge, ...avax, ...dot]
        .filter(c => c.timestamp >= START)
        .sort((a, b) => a.timestamp !== b.timestamp ? a.timestamp - b.timestamp : (priority[a.symbol] || 99) - (priority[b.symbol] || 99));

    console.log(`✅ ${timeline.length} candles loaded. Running 3 scenarios sequentially...\n`);

    const baseline    = await runScenario('BASELINE (No Filter)',    timeline, false, false);
    const weekendRes  = await runScenario('WEEKEND FILTER',          timeline, true,  false);
    const cooldownRes = await runScenario('COOLDOWN FILTER (1.5h)',  timeline, false, true);

    const results = [baseline, weekendRes, cooldownRes];

    console.log('\n════════════════════════════════════════════════');
    console.log('   DOOMSDAY FILTER COMPARISON (Multi-Symbol)');
    console.log('════════════════════════════════════════════════');

    for (const r of results) {
        const total = r.stats.wins + r.stats.losses;
        console.log(`\n─── ${r.label} ───`);
        console.log(`Trades:       ${total}  (skipped: ${r.skipped})`);
        console.log(`Win Rate:     ${total ? ((r.stats.wins/total)*100).toFixed(1) : 0}%`);
        console.log(`Final Bal:    $${r.balance.toFixed(2)}`);
        console.log(`Max Drawdown: ${r.stats.maxDrawdownPercent.toFixed(1)}%`);
        console.log(`Total Fees:   $${r.stats.totalFeesPaid.toFixed(2)}`);
        console.log(`ROI:          ${(((r.balance - 1000) / 1000) * 100).toFixed(1)}%`);
    }

    const best = results.reduce((a, b) => a.balance > b.balance ? a : b);
    console.log('\n════════════════════════════════════════════════');
    console.log(`🏆  WINNER: ${best.label}`);
    console.log(`    Final Balance: $${best.balance.toFixed(2)}`);
    console.log(`    ROI: ${(((best.balance - 1000) / 1000) * 100).toFixed(1)}%`);
    console.log('\n── Symbol Breakdown (Best Scenario) ──');
    for (const sym of Object.keys(best.stats.symbolStats)) {
        const s = best.stats.symbolStats[sym];
        console.log(`  ${sym}: ${s.trades} trades | PnL $${s.pnl.toFixed(2)}`);
    }
    console.log('\n── Period Breakdown (Best Scenario) ──');
    const sortedPeriods = Object.keys(best.stats.periods).sort();
    let running = 1000;
    for (const p of sortedPeriods) {
        const ps = best.stats.periods[p];
        running += ps.pnl;
        console.log(`  ${p}: ${ps.trades} trades | WR ${ps.trades ? ((ps.wins/ps.trades)*100).toFixed(0) : 0}% | PnL $${ps.pnl.toFixed(2)} | Balance $${running.toFixed(2)}`);
    }
    console.log('════════════════════════════════════════════════\n');
}

main().catch(console.error);
