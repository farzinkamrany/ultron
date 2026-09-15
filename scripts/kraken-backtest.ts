import * as fs from 'fs';
import * as readline from 'readline';
import { evaluateForexSetup } from '../src/lib/trading/kraken';
import { detectRegime } from '../src/lib/trading/financial-intelligence';

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
const SPREAD_FEE_PERCENT = 0.0001; // Forex typical tight spread (approx 1 pip)
const MAX_CONCURRENT = 3;

async function loadCSV(filePath: string, symbol: string): Promise<MultiCandle[]> {
    if (!fs.existsSync(filePath)) return [];
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const data: MultiCandle[] = [];
    let isHeader = true;

    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; }
        const [timestamp, open, high, low, close, volume] = line.split(',');
        data.push({
            symbol,
            timestamp: parseInt(timestamp),
            open: parseFloat(open),
            high: parseFloat(high),
            low: parseFloat(low),
            close: parseFloat(close),
            volume: parseFloat(volume)
        });
    }
    return data;
}

async function runKrakenBacktest() {
    console.log("Loading Real Forex Data (EUR/USD)...");
    
    // Load actual EUR/USD 1H data
    const eurusdData = await loadCSV('data/eurusd_1h_history.csv', 'EUR/USD');
    
    const globalTimeline = eurusdData
        .filter(c => c.timestamp >= 1514764800000) // 2018 onwards
        .sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Loaded ${globalTimeline.length} candles. Starting simulation...\n`);

    let balance = INITIAL_CAPITAL;
    let peakBalance = balance;
    let stats = {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        feesPaid: 0,
        maxDrawdown: 0
    };

    let activeTrades: Record<string, any> = {};
    const buffers: Record<string, MultiCandle[]> = {
        'EUR/USD': []
    };

    // A small cache for regime to speed things up
    let cachedRegime = 'NORMAL';

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        const { symbol, timestamp, close: currentPrice } = candle;

        buffers[symbol].push(candle);
        if (buffers[symbol].length > 500) buffers[symbol].shift(); // Keep buffer small for speed

        const candles = buffers[symbol];
        if (candles.length < 250) continue; // Need enough history for SMC

        // Manage active trade
        if (activeTrades[symbol]) {
            const trade = activeTrades[symbol];
            let closed = false;
            let exitPrice = 0;
            
            // Check SL / TP
            if (trade.action === 'BUY') {
                if (candle.low <= trade.stopLoss) { exitPrice = trade.stopLoss; closed = true; }
                else if (candle.high >= trade.takeProfit) { exitPrice = trade.takeProfit; closed = true; }
            } else {
                if (candle.high >= trade.stopLoss) { exitPrice = trade.stopLoss; closed = true; }
                else if (candle.low <= trade.takeProfit) { exitPrice = trade.takeProfit; closed = true; }
            }

            if (closed) {
                // Execute Trade with Forex-like fees and leverage
                // Assuming standard 1:30 leverage or similar risk per trade (e.g., 2% of account)
                const riskAmount = balance * 0.02;
                const slDistance = Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice;
                const positionSizeUSD = riskAmount / slDistance;
                
                const movePerc = trade.action === 'BUY' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice;
                let pnl = positionSizeUSD * movePerc;
                
                // Deduct spread/fees
                const entryFee = positionSizeUSD * SPREAD_FEE_PERCENT;
                const exitFee = positionSizeUSD * SPREAD_FEE_PERCENT;
                pnl -= (entryFee + exitFee);
                
                balance += pnl;
                stats.totalTrades++;
                stats.feesPaid += (entryFee + exitFee);
                if (pnl > 0) stats.wins++;
                else stats.losses++;

                if (balance > peakBalance) peakBalance = balance;
                const dd = (peakBalance - balance) / peakBalance * 100;
                if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;

                delete activeTrades[symbol];
            }
            continue;
        }

        // Generate Signal
        if (Object.keys(activeTrades).length < MAX_CONCURRENT) {
            if (i % 50 === 0) cachedRegime = detectRegime(candles); // Update regime periodically
            
            // Note: Since evaluateForexSetup requires macroCandles, we pass candles as macro for now
            const signal = await evaluateForexSetup(symbol, currentPrice, candles, candles, cachedRegime);
            
            if (signal.action !== 'HOLD') {
                activeTrades[symbol] = {
                    action: signal.action,
                    entryPrice: signal.entryPrice,
                    takeProfit: signal.takeProfit,
                    stopLoss: signal.stopLoss,
                    timestamp: candle.timestamp
                };
            }
        }
    }

    console.log(`============================================`);
    console.log(`   KRAKEN (FOREX) BACKTEST RESULTS`);
    console.log(`   Data: Real EUR/USD (1H)`);
    console.log(`============================================`);
    console.log(`Final Balance:    $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`Total Fees Paid:  $${stats.feesPaid.toFixed(2)}`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Win Rate:         ${stats.totalTrades > 0 ? ((stats.wins / stats.totalTrades) * 100).toFixed(2) : 0}%`);
    console.log(`Loss Rate:        ${stats.totalTrades > 0 ? ((stats.losses / stats.totalTrades) * 100).toFixed(2) : 0}%`);
    console.log(`============================================\n`);
}

runKrakenBacktest().catch(console.error);
