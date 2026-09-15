import * as fs from 'fs';
import * as readline from 'readline';
import { evaluateDoomsdaySetup } from '../src/lib/trading/doomsday';

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
const RISK_PER_TRADE = 0.10; // High conviction, 10% risk per trade
const LEVERAGE = 3;
const TAKER_FEE = 0.0004;

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

async function runDoomsdayBacktest() {
    console.log("Loading 15m Data for DOOMSDAY PROTOCOL...");
    
    // Use BTC history
    const btcData = await loadCSV('data/btc_15m_history.csv', 'BTC');
    const globalTimeline = btcData.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Loaded ${globalTimeline.length} candles. Starting Doomsday simulation...\n`);

    let balance = INITIAL_CAPITAL;
    let peakBalance = balance;
    
    let stats = {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        feesPaid: 0,
        maxDrawdown: 0
    };

    let activeTrade: {
        entryPrice: number,
        tp: number,
        sl: number,
        positionSizeUSD: number,
        timestamp: number
    } | null = null;
    
    let buffer: MultiCandle[] = [];

    for (let i = 0; i < globalTimeline.length; i++) {
        const candle = globalTimeline[i];
        const { close, high, low, open } = candle;
        
        buffer.push(candle);
        if (buffer.length > 20) buffer.shift();

        // 1. Manage Active Trade
        if (activeTrade) {
            let closed = false;
            let exitPrice = 0;
            
            if (low <= activeTrade.sl) { exitPrice = Math.min(activeTrade.sl, open); closed = true; }
            else if (high >= activeTrade.tp) { exitPrice = Math.max(activeTrade.tp, open); closed = true; }

            if (closed) {
                const movePerc = (exitPrice - activeTrade.entryPrice) / activeTrade.entryPrice;
                let pnl = activeTrade.positionSizeUSD * movePerc;
                
                const entryFee = activeTrade.positionSizeUSD * TAKER_FEE;
                const exitFee = activeTrade.positionSizeUSD * TAKER_FEE;
                pnl -= (entryFee + exitFee);
                
                balance += pnl;
                stats.totalTrades++;
                stats.feesPaid += (entryFee + exitFee);
                if (pnl > 0) stats.wins++;
                else stats.losses++;

                if (balance > peakBalance) peakBalance = balance;
                const dd = (peakBalance - balance) / peakBalance * 100;
                if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
                
                activeTrade = null;
            }
            continue;
        }

        // 2. Generate Signal
        if (!activeTrade && buffer.length >= 5) {
            // We use a 7% drop threshold in 1 hour (4x15m candles) as the "Doomsday" trigger
            const signal = evaluateDoomsdaySetup(buffer, 7.0);
            
            if (signal.action === 'BUY') {
                const slDistancePerc = Math.abs(close - signal.sl) / close;
                const riskAmount = balance * RISK_PER_TRADE;
                let positionSizeUSD = riskAmount / slDistancePerc;
                
                if (positionSizeUSD > balance * LEVERAGE) {
                    positionSizeUSD = balance * LEVERAGE;
                }
                
                activeTrade = {
                    entryPrice: close,
                    tp: signal.tp,
                    sl: signal.sl,
                    positionSizeUSD,
                    timestamp: candle.timestamp
                };
                
                // console.log(`[DOOMSDAY TRIGGERED] Date: ${new Date(candle.timestamp).toISOString()} | Price: $${close} | ${signal.reason}`);
            }
        }
    }

    console.log(`============================================`);
    console.log(`   DOOMSDAY PROTOCOL BACKTEST`);
    console.log(`   Data: BTC 15m (Multi-Year)`);
    console.log(`============================================`);
    console.log(`Final Equity:     $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`Total Trades:     ${stats.totalTrades}`);
    console.log(`Win Rate:         ${stats.totalTrades > 0 ? ((stats.wins / stats.totalTrades) * 100).toFixed(2) : 0}%`);
    console.log(`============================================\n`);
}

runDoomsdayBacktest().catch(console.error);
