/**
 * Ultron Orchestrator Cron
 *
 * Runs every 4 hours (matching 4H candle cadence).
 * For each symbol:
 *  1. Fetches 4H OHLCV from exchange (KuCoin, no auth required)
 *  2. Loads persisted SymbolState from Redis
 *  3. Runs processSymbol() from ultron-engine
 *  4. Persists updated state back to Redis
 *  5. Converts any signals into paper_trades rows in Supabase
 *  6. Sends Telegram notification for new entries/exits
 */

import { NextRequest, NextResponse } from 'next/server';
import ccxt from 'ccxt';
import { redis } from '@/lib/redis';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { verifyQStashSignature } from '@/lib/qstash';
import { processSymbol, LiveSymbolState, DEFAULT_SYMBOL_STATE, OrchestratorSignal } from '@/lib/trading/ultron-engine';
import { Candle } from '@/lib/trading/financial-intelligence';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// The 10 symbols the backtest proved work best
const SYMBOLS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'LINK/USDT', 'ADA/USDT',
  'DOGE/USDT', 'BNB/USDT', 'XRP/USDT', 'DOT/USDT', 'AVAX/USDT'
];

const REDIS_STATE_PREFIX = 'ultron_engine_state:';

async function loadState(symbol: string): Promise<LiveSymbolState> {
  try {
    const raw = await redis.get(`${REDIS_STATE_PREFIX}${symbol}`);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { ...DEFAULT_SYMBOL_STATE, symbol, ...parsed };
    }
  } catch (e) {
    console.error(`[Orchestrator] Failed to load state for ${symbol}:`, e);
  }
  return { symbol, ...DEFAULT_SYMBOL_STATE };
}

async function saveState(state: LiveSymbolState): Promise<void> {
  try {
    await redis.set(`${REDIS_STATE_PREFIX}${state.symbol}`, JSON.stringify(state), { ex: 60 * 60 * 24 * 30 }); // 30-day TTL
  } catch (e) {
    console.error(`[Orchestrator] Failed to save state for ${state.symbol}:`, e);
  }
}

async function getAccountBalance(): Promise<number> {
  const mode = process.env.TRADE_MODE || 'PAPER';
  if (mode === 'PAPER') {
    // Calculate current paper balance: starting capital + all closed trade PnL
    const { data } = await supabase
      .from('paper_trades')
      .select('pnl')
      .not('pnl', 'is', null)
      .in('status', ['WON', 'LOST']);
    const closedPnl = (data || []).reduce((sum, t) => sum + (t.pnl || 0), 0);
    return 1000 + closedPnl; // $1000 starting capital
  }
  // For MICRO: fetch from Hyperliquid
  try {
    const exchange = new ccxt.hyperliquid({
      walletAddress: process.env.HYPERLIQUID_WALLET || '',
      privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || '',
    });
    const balInfo = await exchange.fetchBalance();
    return balInfo['USDC']?.total || balInfo['USDT']?.total || 1000;
  } catch {
    return 1000;
  }
}

async function getTotalMarginUsed(): Promise<number> {
  // For paper trading: count open trades as margin used
  const { data } = await supabase
    .from('paper_trades')
    .select('position_size_usd')
    .eq('status', 'OPEN');
  
  return (data || []).reduce((sum, t) => sum + (t.position_size_usd || 0), 0);
}

async function executeSignal(signal: OrchestratorSignal, currentPrice: number): Promise<void> {
  const mode = process.env.TRADE_MODE || 'PAPER';
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  // For GRID_UPDATE signals, just log to Telegram — no trade insertion needed
  if (signal.action === 'GRID_UPDATE') {
    if (adminChatId) {
      await sendTelegramMessage(adminChatId, 
        `🔷 <b>BEHEMOTH GRID</b> | ${signal.symbol}\n📐 ${signal.reason}\n💰 Capital: $${signal.positionSizeUsd.toFixed(0)}`
      );
    }
    return;
  }

  const isOpen = signal.action === 'OPEN_LONG' || signal.action === 'OPEN_SHORT';
  const isClose = signal.action === 'CLOSE_LONG' || signal.action === 'CLOSE_SHORT';

  if (isOpen) {
    // Check: don't open duplicate trades for same symbol+strategy
    const { data: existing } = await supabase
      .from('paper_trades')
      .select('id')
      .eq('symbol', signal.symbol)
      .eq('status', 'OPEN')
      .ilike('rationale', `%${signal.strategy}%`);

    if (existing && existing.length > 0) {
      console.log(`[Orchestrator] Skipping ${signal.symbol} ${signal.strategy} - trade already open`);
      return;
    }

    const posType = signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT';
    const emoji = signal.strategy === 'BEHEMOTH' ? '🔷' : signal.strategy === 'LEVIATHAN' ? '🐉' : '🦈';

    if (mode === 'PAPER') {
      const { error } = await supabase.from('paper_trades').insert({
        symbol: signal.symbol,
        position_type: posType,
        entry_price: currentPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        status: 'OPEN',
        pnl: 0,
        rationale: `[${signal.strategy}] ${signal.reason}`,
        position_size_usd: signal.positionSizeUsd,
      });
      if (error) {
        console.error(`[Orchestrator] Failed to insert paper trade:`, error.message);
        return;
      }
    } else if (mode === 'MICRO' && (signal.strategy === 'LEVIATHAN' || signal.strategy === 'MEGALODON')) {
      try {
        const exchange = new ccxt.hyperliquid({
          walletAddress: process.env.HYPERLIQUID_WALLET || '',
          privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || '',
          enableRateLimit: true,
        });
        await exchange.loadMarkets();
        
        // Hyperliquid unified symbol format: BTC/USDC:USDC
        const baseSymbol = signal.symbol.split('/')[0];
        const formattedSymbol = `${baseSymbol}/USDC:USDC`;
        const amount = signal.positionSizeUsd / currentPrice;
        const side = signal.action === 'OPEN_LONG' ? 'buy' : 'sell';
        
        // Market entry (CCXT handles precision formatting internally after loadMarkets)
        await exchange.createMarketOrder(formattedSymbol, side, amount);
        
        // Stop Loss & Take Profit logic (Hyperliquid uses specific params, but we use CCXT unified)
        const oppositeSide = side === 'buy' ? 'sell' : 'buy';
        try {
           await exchange.createOrder(formattedSymbol, 'stop', oppositeSide, amount, undefined, { stopPrice: signal.stopLoss });
           await exchange.createOrder(formattedSymbol, 'take_profit', oppositeSide, amount, signal.takeProfit, { stopPrice: signal.takeProfit });
        } catch (e: any) {
           console.error(`[Orchestrator] Failed to place SL/TP for ${formattedSymbol}:`, e.message);
        }
      } catch (e: any) {
        console.error(`[Orchestrator] Failed MICRO execution for ${signal.symbol}:`, e.message);
      }
    }

    if (adminChatId) {
      await sendTelegramMessage(adminChatId,
        `${emoji} <b>${signal.strategy} ENTRY</b> | ${posType} ${signal.symbol}\n` +
        `📍 Entry: $${currentPrice.toFixed(4)}\n` +
        `🎯 TP: $${signal.takeProfit.toFixed(4)}\n` +
        `🛑 SL: $${signal.stopLoss.toFixed(4)}\n` +
        `💰 Size: $${signal.positionSizeUsd.toFixed(0)}\n` +
        `📝 ${signal.reason}`
      );
    }
  }

  if (isClose) {
    // Find matching open trade and close it
    const posType = signal.action === 'CLOSE_LONG' ? 'LONG' : 'SHORT';
    const { data: openTrade } = await supabase
      .from('paper_trades')
      .select('*')
      .eq('symbol', signal.symbol)
      .eq('status', 'OPEN')
      .eq('position_type', posType)
      .ilike('rationale', `%${signal.strategy}%`)
      .limit(1)
      .single();

    if (!openTrade) return;

    const qty = (openTrade.position_size_usd || 1000) / openTrade.entry_price;
    const pnl = posType === 'LONG'
      ? (currentPrice - openTrade.entry_price) * qty
      : (openTrade.entry_price - currentPrice) * qty;
    const won = pnl > 0;

    if (mode === 'PAPER') {
      await supabase.from('paper_trades').update({
        status: won ? 'WON' : 'LOST',
        pnl: pnl,
        closed_at: new Date().toISOString(),
      }).eq('id', openTrade.id);
    } else if (mode === 'MICRO' && (signal.strategy === 'LEVIATHAN' || signal.strategy === 'MEGALODON')) {
      try {
        const exchange = new ccxt.hyperliquid({
          walletAddress: process.env.HYPERLIQUID_WALLET || '',
          privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || '',
          enableRateLimit: true,
        });
        await exchange.loadMarkets();
        
        const baseSymbol = signal.symbol.split('/')[0];
        const formattedSymbol = `${baseSymbol}/USDC:USDC`;
        
        // First cancel open SL/TP orders
        try {
           await exchange.cancelAllOrders(formattedSymbol);
        } catch(e) {}
        
        // Close position with Market Order
        const amount = (openTrade.position_size_usd || signal.positionSizeUsd) / openTrade.entry_price;
        const side = signal.action === 'CLOSE_LONG' ? 'sell' : 'buy';
        await exchange.createMarketOrder(formattedSymbol, side, amount);
      } catch (e: any) {
        console.error(`[Orchestrator] Failed MICRO close execution for ${signal.symbol}:`, e.message);
      }
    }

    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (adminChatId) {
      const emoji = won ? '✅' : '❌';
      await sendTelegramMessage(adminChatId,
        `${emoji} <b>${signal.strategy} EXIT</b> | ${posType} ${signal.symbol}\n` +
        `📍 Exit: $${currentPrice.toFixed(4)}\n` +
        `💸 PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}\n` +
        `📝 ${signal.reason}`
      );
    }
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    const authHeader = req.headers.get('authorization');
    const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    const isQStash = !!req.headers.get('upstash-signature');
    if (isQStash) {
      const valid = await verifyQStashSignature(req);
      if (!valid) return new NextResponse('Unauthorized', { status: 401 });
    } else if (!isVercelCron) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const results: string[] = [];

  try {
    const exchange = new ccxt.kucoin({ enableRateLimit: true });
    const accountBalance = await getAccountBalance();
    const totalMarginUsed = await getTotalMarginUsed();

    console.log(`[Orchestrator] Balance: $${accountBalance.toFixed(2)} | Margin Used: $${totalMarginUsed.toFixed(2)}`);

    for (const symbol of SYMBOLS) {
      try {
        // Fetch 4H candles — 1000 candles = ~166 days (enough for EMA50/200)
        // For Megalodon (EMA800) we need at least 800 candles = ~133 days of 4H
        const ohlcv = await exchange.fetchOHLCV(symbol, '4h', undefined, 1000);
        if (ohlcv.length < 200) {
          console.warn(`[Orchestrator] Not enough data for ${symbol}: ${ohlcv.length} candles`);
          continue;
        }

        const candles: Candle[] = ohlcv.map(c => ({
          timestamp: c[0] as number,
          open: c[1] as number,
          high: c[2] as number,
          low: c[3] as number,
          close: c[4] as number,
          volume: c[5] as number,
        }));

        const currentPrice = candles[candles.length - 1].close;
        const state = await loadState(symbol);
        const { state: newState, signals } = processSymbol(state, candles, accountBalance, totalMarginUsed);

        await saveState(newState);

        for (const signal of signals) {
          await executeSignal(signal, currentPrice);
          results.push(`[${signal.strategy}] ${symbol}: ${signal.action}`);
        }

        console.log(`[Orchestrator] ${symbol}: regime=${newState.currentRegime}, signals=${signals.length}`);
      } catch (symErr: any) {
        console.error(`[Orchestrator] Error processing ${symbol}:`, symErr.message);
      }
    }

    return NextResponse.json({ success: true, processed: SYMBOLS.length, signals: results });
  } catch (err: any) {
    console.error('[Orchestrator Cron] Fatal error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
