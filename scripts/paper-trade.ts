import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from '../src/lib/trading/gann';
import { findOrderBlocks } from '../src/lib/trading/ict';
import { loadPaperState, savePaperState } from '../src/lib/trading/paperState';

const SYMBOL = 'BTC/USDT';
const TIMEFRAME = '5m';
const SMC_LOOKBACK = 10;
const RISK_PERC = 0.01;
const MAKER_FEE = 0.0002;
const TAKER_FEE = 0.0005;
const SL_BUFFER = 0.003;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`[INIT] Starting Paper Trading Engine for ${SYMBOL} on ${TIMEFRAME} timeframe...`);
  
  const state = loadPaperState();
  console.log(`[STATE] Loaded virtual balance: $${state.balance.toFixed(2)}`);
  if (state.activeTrade) {
    console.log(`[STATE] Active trade found: ${state.activeTrade.action} from $${state.activeTrade.entryPrice}`);
  }

  // Use Kucoin for public data since Binance API is blocked
  const exchange = new ccxt.kucoin({ enableRateLimit: true });

  // Build the initial lookback window
  let candles: any[] = [];
  try {
    console.log(`[NET] Fetching initial candles...`);
    const ohlcv = await exchange.fetchOHLCV(SYMBOL, TIMEFRAME, undefined, SMC_LOOKBACK + 5);
    candles = ohlcv.map(c => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number
    }));
    console.log(`[INIT] Fetched ${candles.length} candles successfully.`);
  } catch (err) {
    console.error('[ERROR] Failed to fetch initial candles:', err);
    return;
  }

  let lastCandleTimestamp = candles[candles.length - 1].timestamp;

  console.log(`[RUN] Engine is live and monitoring price action...`);

  while (true) {
    try {
      // Polling every 10 seconds
      const ticker = await exchange.fetchTicker(SYMBOL);
      const currentPrice = ticker.last;
      const nowTimestamp = Date.now();
      
      if (!currentPrice) {
        await sleep(10000);
        continue;
      }

      // Check if we need to fetch a new closed candle
      if (nowTimestamp - lastCandleTimestamp >= 900000) {
        const ohlcv = await exchange.fetchOHLCV(SYMBOL, TIMEFRAME, undefined, 5);
        for (const c of ohlcv) {
          const cTs = c[0] as number;
          if (cTs > lastCandleTimestamp) {
            candles.push({ timestamp: cTs, open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] });
            lastCandleTimestamp = cTs;
            console.log(`[DATA] New candle closed at ${new Date(cTs).toLocaleTimeString()} - Close: $${c[4]}`);
          }
        }
        while (candles.length > SMC_LOOKBACK + 5) {
          candles.shift();
        }
      }

      // 1. Process active trade
      if (state.activeTrade) {
        let closed = false;
        let isWin = false;
        let exitPrice = 0;
        const trade = state.activeTrade;

        if (trade.action === 'BUY') {
          if (currentPrice <= trade.sl) { exitPrice = trade.sl; closed = true; }
          else if (trade.pyramidStage === 0 && currentPrice >= trade.entryPrice + (trade.tp - trade.entryPrice) * 0.5) {
            trade.sl = trade.entryPrice; trade.pyramidStage = 1;
            console.log(`[PAPER] Moved SL to break-even for BUY.`);
            savePaperState(state);
          }
          else if (currentPrice >= trade.tp) { exitPrice = trade.tp; closed = true; isWin = true; }
        } else { // SELL
          if (currentPrice >= trade.sl) { exitPrice = trade.sl; closed = true; }
          else if (trade.pyramidStage === 0 && currentPrice <= trade.entryPrice - (trade.entryPrice - trade.tp) * 0.5) {
            trade.sl = trade.entryPrice; trade.pyramidStage = 1;
            console.log(`[PAPER] Moved SL to break-even for SELL.`);
            savePaperState(state);
          }
          else if (currentPrice <= trade.tp) { exitPrice = trade.tp; closed = true; isWin = true; }
        }

        if (closed) {
          const movePerc = trade.action === 'BUY' ? (exitPrice - trade.entryPrice) / trade.entryPrice : (trade.entryPrice - exitPrice) / trade.entryPrice;
          const positionMultiplier = trade.pyramidStage > 0 ? 2 : 1;
          const stopLossPerc = Math.abs(trade.entryPrice - trade.initialSl) / trade.entryPrice;
          const positionSize = trade.riskAmount / stopLossPerc;
          const rawPnl = positionSize * movePerc * positionMultiplier;
          const entryFee = positionSize * TAKER_FEE;
          const exitFee = (positionSize + Math.abs(rawPnl)) * (isWin ? MAKER_FEE : TAKER_FEE);
          
          const netPnl = rawPnl - entryFee - exitFee;
          state.balance += netPnl;
          state.totalTrades++;
          if (netPnl > 0) state.wins++;

          if (state.balance > state.peakBalance) state.peakBalance = state.balance;
          const dd = state.peakBalance - state.balance;
          if (dd > state.maxDrawdown) state.maxDrawdown = dd;

          console.log(`\n=========================================`);
          console.log(`[TRADE CLOSED] ${trade.action}`);
          console.log(`Entry: $${trade.entryPrice.toFixed(2)} | Exit: $${exitPrice.toFixed(2)}`);
          console.log(`Net PnL: $${netPnl.toFixed(2)}`);
          console.log(`New Balance: $${state.balance.toFixed(2)}`);
          console.log(`=========================================\n`);

          state.tradeHistory.push({
            ...trade,
            exitPrice,
            netPnl,
            closeTimestamp: nowTimestamp
          });
          state.activeTrade = null;
          savePaperState(state);
        }
      } else {
        // 2. Scan for new entries
        const { supports, resistances } = calculateGannSquareOf9(currentPrice);
        let closestSupport = 0, closestResistance = 0;
        for (const s of supports) if (currentPrice >= s) { closestSupport = s; break; }
        for (const r of resistances) if (r >= currentPrice) { closestResistance = r; break; }

        if (closestSupport > 0 && closestResistance > 0) {
          const distToSupp = (currentPrice - closestSupport) / currentPrice;
          const distToRes = (closestResistance - currentPrice) / currentPrice;
          
          let action: 'BUY' | 'SELL' | null = null;
          let tp = 0, sl = 0;

          if (distToSupp <= SL_BUFFER) {
            const longSL = closestSupport * (1 - SL_BUFFER);
            const validTP = resistances.find(r => (r - currentPrice) / (currentPrice - longSL) >= 2.0);
            if (validTP) { action = 'BUY'; tp = validTP; sl = longSL; }
          } else if (distToRes <= SL_BUFFER) {
            const shortSL = closestResistance * (1 + SL_BUFFER);
            const validTP = supports.find(s => (currentPrice - s) / (shortSL - currentPrice) >= 2.0);
            if (validTP) { action = 'SELL'; tp = validTP; sl = shortSL; }
          }

          if (action) {
            const obs = findOrderBlocks(candles);
            const isValid = action === 'BUY'
              ? !!obs.find(ob => ob.type === 'BULLISH_OB' && ob.sweptLiquidity)
              : !!obs.find(ob => ob.type === 'BEARISH_OB' && ob.sweptLiquidity);
            
            if (isValid) {
              const riskAmount = state.balance * RISK_PERC;
              state.activeTrade = { 
                action, 
                entryPrice: currentPrice, 
                tp, 
                sl, 
                initialSl: sl, 
                pyramidStage: 0, 
                riskAmount,
                openTimestamp: nowTimestamp
              };
              console.log(`\n=========================================`);
              console.log(`[TRADE OPENED] ${action}`);
              console.log(`Price: $${currentPrice.toFixed(2)} | TP: $${tp.toFixed(2)} | SL: $${sl.toFixed(2)}`);
              console.log(`=========================================\n`);
              savePaperState(state);
            }
          }
        }
      }

      await sleep(10000);
    } catch (err) {
      console.error('[ERROR] Loop error:', err);
      await sleep(15000);
    }
  }
}

main().catch(console.error);
