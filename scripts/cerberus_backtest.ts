import * as fs from 'fs';
import * as readline from 'readline';
import { evaluateCerberusSetup, CerberusSignal } from '../src/lib/trading/cerberus';

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
const LEVERAGE = 3; 
const TAKER_FEE = 0.0004; // 0.04%

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

async function runCerberusBacktest() {
    console.log("Loading 1H Data for CERBERUS (Pairs Trader)...");
    
    const btcData = await loadCSV('data/btc_1h_history.csv', 'BTC');
    const ethData = await loadCSV('data/eth_1h_history.csv', 'ETH');
    
    // Create a dictionary for quick ETH lookup by timestamp
    const ethMap = new Map<number, MultiCandle>();
    for (const c of ethData) ethMap.set(c.timestamp, c);

    // Merge Timeline (Only keep timestamps where both BTC and ETH exist)
    const globalTimeline: { btc: MultiCandle, eth: MultiCandle, timestamp: number }[] = [];
    
    for (const btcCandle of btcData) {
        const ethCandle = ethMap.get(btcCandle.timestamp);
        if (ethCandle) {
            globalTimeline.push({ btc: btcCandle, eth: ethCandle, timestamp: btcCandle.timestamp });
        }
    }

    globalTimeline.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`Loaded ${globalTimeline.length} perfectly aligned 1H candles. Starting Statistical Arbitrage simulation...\n`);

    let balance = INITIAL_CAPITAL;
    let peakBalance = balance;
    
    let stats = {
        totalHedges: 0,
        wins: 0,
        losses: 0,
        feesPaid: 0,
        maxDrawdown: 0
    };

    let btcBuffer: MultiCandle[] = [];
    let ethBuffer: MultiCandle[] = [];
    
    // Active Hedge State
    let activeHedge: {
        type: 'HEDGE_LONG_BTC' | 'HEDGE_LONG_ETH',
        btcEntry: number,
        ethEntry: number,
        btcPositionSize: number, // Fiat
        ethPositionSize: number, // Fiat
    } | null = null;

    for (let i = 0; i < globalTimeline.length; i++) {
        const { btc, eth, timestamp } = globalTimeline[i];
        
        btcBuffer.push(btc);
        ethBuffer.push(eth);
        if (btcBuffer.length > 250) btcBuffer.shift();
        if (ethBuffer.length > 250) ethBuffer.shift();

        if (btcBuffer.length < 200) continue;

        const signal = evaluateCerberusSetup(btcBuffer, ethBuffer, 200, 2.0);

        if (activeHedge) {
            // Check Mean Reversion (Exit Condition)
            if (signal.action === 'CLOSE_ALL' || signal.action !== activeHedge.type && signal.action !== 'HOLD') {
                // Close the hedge
                let btcPnl = 0;
                let ethPnl = 0;
                
                if (activeHedge.type === 'HEDGE_LONG_BTC') {
                    // Long BTC, Short ETH
                    const btcMove = (btc.open - activeHedge.btcEntry) / activeHedge.btcEntry;
                    const ethMove = (activeHedge.ethEntry - eth.open) / activeHedge.ethEntry;
                    btcPnl = activeHedge.btcPositionSize * btcMove;
                    ethPnl = activeHedge.ethPositionSize * ethMove;
                } else {
                    // Short BTC, Long ETH
                    const btcMove = (activeHedge.btcEntry - btc.open) / activeHedge.btcEntry;
                    const ethMove = (eth.open - activeHedge.ethEntry) / activeHedge.ethEntry;
                    btcPnl = activeHedge.btcPositionSize * btcMove;
                    ethPnl = activeHedge.ethPositionSize * ethMove;
                }
                
                const totalGrossPnl = btcPnl + ethPnl;
                
                // Fees on exit for both legs
                const btcExitFee = activeHedge.btcPositionSize * TAKER_FEE;
                const ethExitFee = activeHedge.ethPositionSize * TAKER_FEE;
                
                const totalNetPnl = totalGrossPnl - btcExitFee - ethExitFee;
                
                balance += totalNetPnl;
                stats.feesPaid += (btcExitFee + ethExitFee);
                
                if (totalNetPnl > 0) stats.wins++;
                else stats.losses++;
                
                stats.totalHedges++;
                activeHedge = null;
            }
        } 
        
        if (!activeHedge) {
            // Check Entry Condition
            if (signal.action === 'HEDGE_LONG_BTC' || signal.action === 'HEDGE_LONG_ETH') {
                // Open new hedge
                // Allocate 50% of leveraged balance to BTC and 50% to ETH
                const legSize = (balance * LEVERAGE) / 2;
                
                // Fees on entry
                const btcEntryFee = legSize * TAKER_FEE;
                const ethEntryFee = legSize * TAKER_FEE;
                balance -= (btcEntryFee + ethEntryFee);
                stats.feesPaid += (btcEntryFee + ethEntryFee);
                
                activeHedge = {
                    type: signal.action,
                    btcEntry: btc.close,
                    ethEntry: eth.close,
                    btcPositionSize: legSize,
                    ethPositionSize: legSize
                };
            }
        }
        
        if (balance > peakBalance) peakBalance = balance;
        const dd = (peakBalance - balance) / peakBalance * 100;
        if (dd > stats.maxDrawdown) stats.maxDrawdown = dd;
        
        if (balance <= 50) {
            console.log(`💀 ACCOUNT BLOWN UP!`);
            break;
        }
    }

    console.log(`============================================`);
    console.log(`   CERBERUS STAT-ARB (1H) BACKTEST`);
    console.log(`   Data: BTC/ETH Spread`);
    console.log(`============================================`);
    console.log(`Final Equity:     $${balance.toFixed(2)} (Start: $${INITIAL_CAPITAL})`);
    console.log(`Peak Equity:      $${peakBalance.toFixed(2)}`);
    console.log(`Net Profit:       $${(balance - INITIAL_CAPITAL).toFixed(2)}`);
    console.log(`Max Drawdown:     ${stats.maxDrawdown.toFixed(2)}%`);
    console.log(`Total Hedges:     ${stats.totalHedges}`);
    console.log(`Win Rate:         ${stats.totalHedges > 0 ? ((stats.wins / stats.totalHedges) * 100).toFixed(2) : 0}%`);
    console.log(`Fees Paid:        $${stats.feesPaid.toFixed(2)}`);
    console.log(`============================================\n`);
}

runCerberusBacktest().catch(console.error);
