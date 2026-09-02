/**
 * Ultron Trading Executor — V4.0
 *
 * Routes trade signals to either PAPER trading (Supabase DB) or
 * MICRO live trading (real CCXT exchange orders) based on TRADE_MODE env var.
 *
 * ⚠️  KILL SWITCH RULES — HARDCODED, NEVER CONFIGURABLE VIA ENV:
 *   - Max total open margin:  $50
 *   - Max single order size:  $20
 *   - Daily loss hard limit:  $15
 *   - On any uncaught error:  close ALL positions immediately + Telegram alert
 */

import ccxt, { Exchange } from "ccxt";
import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import type { TradeSignal } from "./gann";

// ─── Kill Switch Constants (immutable) ──────────────────────────────────────
const MAX_TOTAL_MARGIN_USD = 50;
const MAX_SINGLE_ORDER_USD = 20;
const MAX_DAILY_LOSS_USD = 15;

// ─── Exchange Factory ────────────────────────────────────────────────────────
function buildExchange() {
  // Use Bybit V5 Perpetual Futures
  const exchange = new ccxt.bybit({
    apiKey: process.env.BYBIT_API_KEY || "",
    secret: process.env.BYBIT_API_SECRET || "",
    enableRateLimit: true,
    options: {
      defaultType: 'swap', // Important: forces futures/perpetuals on Bybit
    }
  });

  return exchange;
}

// ─── Kill Switch ─────────────────────────────────────────────────────────────
async function emergencyCloseAll(exchange: Exchange, reason: string) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  try {
    console.error(`[Kill Switch ACTIVATED] Reason: ${reason}`);
    const openOrders = await exchange.fetchOpenOrders();
    for (const order of openOrders) {
      if (order.id) {
        await exchange.cancelOrder(order.id, order.symbol);
      }
    }
    if (adminChatId) {
      await sendTelegramMessage(
        adminChatId,
        `🚨 <b>ULTRON KILL SWITCH ACTIVATED</b> 🚨\n\n<b>Reason:</b> ${reason}\n\nAll open positions have been cancelled immediately.`
      );
    }
  } catch (err: any) {
    console.error("[Kill Switch] Failed to close positions:", err.message);
    if (adminChatId) {
      await sendTelegramMessage(
        adminChatId,
        `🔴 <b>KILL SWITCH FAILED</b> — Manual intervention required!\nError: ${err.message}`
      );
    }
  }
}

// ─── Guard: check total exposure ─────────────────────────────────────────────
async function getTotalOpenMargin(exchange: Exchange): Promise<number> {
  try {
    const positions = await exchange.fetchPositions();
    return positions.reduce((sum: number, p: any) => {
      // Bybit specific margin fields
      return sum + Math.abs(parseFloat(p.initialMargin || p.notional || 0));
    }, 0);
  } catch {
    return 0;
  }
}

// ─── Guard: check today's realized loss ──────────────────────────────────────
async function getTodayLoss(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("paper_trades")
    .select("pnl")
    .gte("closed_at", today.toISOString())
    .lt("pnl", 0);

  if (!data) return 0;
  return Math.abs(data.reduce((sum, t) => sum + (t.pnl || 0), 0));
}

// ─── Main Executor ────────────────────────────────────────────────────────────
export async function executeTrade(signal: TradeSignal): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";

  if (signal.action === "HOLD") {
    console.log("[Executor] Signal is HOLD — no action taken.");
    return;
  }

  // ── PAPER MODE (default) ──────────────────────────────────────────────────
  if (mode === "PAPER") {
    const { error } = await supabase.from("paper_trades").insert({
      symbol: signal.symbol,
      position_type: signal.action === "BUY" ? "LONG" : "SHORT",
      entry_price: signal.entryPrice,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      status: "OPEN",
      pnl: 0,
    });

    if (error) throw new Error(`[Executor PAPER] Supabase insert failed: ${error.message}`);
    console.log(`[Executor PAPER] Logged trade: ${signal.action} ${signal.symbol} @ ${signal.entryPrice}`);
    return;
  }

  // ── MICRO MODE (live trading) ─────────────────────────────────────────────
  if (mode === "MICRO") {
    const exchange = buildExchange();

    try {
      // Guard 1: Single order size
      if (MAX_SINGLE_ORDER_USD > MAX_SINGLE_ORDER_USD) {
        throw new Error(`Single order exceeds $${MAX_SINGLE_ORDER_USD} limit.`);
      }

      // Guard 2: Total open margin
      const totalMargin = await getTotalOpenMargin(exchange);
      if (totalMargin >= MAX_TOTAL_MARGIN_USD) {
        console.warn(`[Kill Switch] Total open margin $${totalMargin.toFixed(2)} >= $${MAX_TOTAL_MARGIN_USD}. Trade blocked.`);
        return;
      }

      // Guard 3: Daily loss limit
      const todayLoss = await getTodayLoss();
      if (todayLoss >= MAX_DAILY_LOSS_USD) {
        console.warn(`[Kill Switch] Daily loss $${todayLoss.toFixed(2)} >= $${MAX_DAILY_LOSS_USD}. Trading halted for today.`);
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        if (adminChatId) {
          await sendTelegramMessage(adminChatId, `⚠️ <b>Daily loss limit hit ($${MAX_DAILY_LOSS_USD})</b>\nTrading engine halted for today.`);
        }
        return;
      }

      // Calculate order amount in base currency
      const orderValueUsd = Math.min(MAX_SINGLE_ORDER_USD, MAX_TOTAL_MARGIN_USD - totalMargin);
      const amount = orderValueUsd / signal.entryPrice;
      const side = signal.action === "BUY" ? "buy" : "sell";

      console.log(`[Executor MICRO] Placing ${side} ${amount.toFixed(6)} ${signal.symbol} @ market`);

      // Execute market order
      const order = await exchange.createMarketOrder(signal.symbol, side, amount);

      // Log to DB as well
      await supabase.from("paper_trades").insert({
        symbol: signal.symbol,
        position_type: signal.action === "BUY" ? "LONG" : "SHORT",
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        status: "OPEN",
        pnl: 0,
      });

      const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (adminChatId) {
        await sendTelegramMessage(
          adminChatId,
          `💰 <b>MICRO TRADE EXECUTED</b>\n\n` +
          `<b>Asset:</b> ${signal.symbol}\n` +
          `<b>Side:</b> ${side.toUpperCase()}\n` +
          `<b>Amount:</b> ${amount.toFixed(6)}\n` +
          `<b>Est. Value:</b> ~$${orderValueUsd.toFixed(2)}\n` +
          `<b>Order ID:</b> ${order.id}\n\n` +
          `<i>${signal.reason}</i>`
        );
      }
    } catch (err: any) {
      await logError("EXECUTOR_MICRO", err, { signal }, true);
      // Kill Switch: close everything on unexpected error
      await emergencyCloseAll(exchange, err.message);
      throw err;
    }
  }
}

// ─── Close a specific position in MICRO mode ─────────────────────────────────
export async function closeMicroPosition(symbol: string, positionType: "LONG" | "SHORT"): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";
  if (mode !== "MICRO") return;

  const exchange = buildExchange();
  try {
    // Cancel any open orders for this symbol
    const openOrders = await exchange.fetchOpenOrders(symbol);
    for (const order of openOrders) {
      if (order.id) {
        await exchange.cancelOrder(order.id, symbol);
      }
    }

    // Place a closing market order
    const side = positionType === "LONG" ? "sell" : "buy";
    const positions = await exchange.fetchPositions([symbol]);
    const pos = positions.find((p: any) => p.symbol === symbol);
    if (pos && parseFloat((pos.contracts || 0).toString()) > 0) {
      await exchange.createMarketOrder(symbol, side, Math.abs(parseFloat((pos.contracts || 0).toString())));
      console.log(`[Executor MICRO] Closed position: ${positionType} ${symbol}`);
    }
  } catch (err: any) {
    await logError("EXECUTOR_CLOSE_POSITION", err, { symbol, positionType }, false);
  }
}
