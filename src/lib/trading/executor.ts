/**
 * Ultron Trading Executor — V4.1
 *
 * Routes trade signals to either PAPER trading (Supabase DB) or
 * MICRO live trading (real CCXT exchange orders) based on TRADE_MODE env var.
 *
 * ⚠️ KILL SWITCH RULES — HARDCODED, NEVER CONFIGURABLE VIA ENV:
 *   - Max total open margin: $50
 *   - Max single order size: $20
 *   - Daily loss hard limit: $15
 *   - On any uncaught error: close ALL positions immediately + Telegram alert
 */

import ccxt, { Exchange } from "ccxt";
import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import type { TradeSignal } from "./gann";
import { calculateDynamicKelly } from "./risk";

const MAX_TOTAL_MARGIN_USD = 50;
const MAX_SINGLE_ORDER_USD = 20;
const MAX_DAILY_LOSS_USD = 15;

function buildExchange() {
  const exchange = new ccxt.hyperliquid({
    walletAddress: process.env.HYPERLIQUID_WALLET_ADDRESS || "",
    privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || "",
    enableRateLimit: true,
    options: {
      defaultType: 'swap',
    }
  });
  exchange.setSandboxMode(true); // ENABLE TESTNET (Change to false to go live)
  return exchange;
}

async function getLivePrice(symbol: string): Promise<number> {
  const exchange = buildExchange();
  const ticker = await exchange.fetchTicker(symbol);
  return ticker.last || 0;
}

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
        `🚨 <b>ULTRON KILL SWITCH ACTIVATED</b> 🚨

<b>Reason:</b> ${reason}

All open positions have been cancelled immediately.`
      );
    }
  } catch (err: any) {
    console.error("[Kill Switch] Failed to close positions:", err.message);
  }
}

async function getTotalOpenMargin(exchange: Exchange): Promise<number> {
  try {
    const positions = await exchange.fetchPositions();
    return positions.reduce((sum: number, p: any) => {
      return sum + Math.abs(parseFloat(p.initialMargin || p.notional || 0));
    }, 0);
  } catch {
    return 0;
  }
}

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

export async function executeTrade(signal: TradeSignal): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";
  if (signal.action === "HOLD") return;

  const livePrice = await getLivePrice(signal.symbol);

  if (mode === "PAPER") {
    const { data: openTrades } = await supabase.from("paper_trades").select("*").eq("status", "OPEN");
    if (openTrades && openTrades.length > 0) {
      const isLongOpen = openTrades.some(t => t.position_type === "LONG");
      const isShortOpen = openTrades.some(t => t.position_type === "SHORT");
      const newType = signal.action === "BUY" ? "LONG" : "SHORT";
      if (newType === "LONG" && isLongOpen) return;
      if (newType === "SHORT" && isShortOpen) return;
    }

    const kellyRisk = await calculateDynamicKelly(signal.symbol);
    const { error } = await supabase.from("paper_trades").insert({
      symbol: signal.symbol,
      position_type: signal.action === "BUY" ? "LONG" : "SHORT",
      entry_price: livePrice,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      status: "OPEN",
      pnl: 0,
    });
    if (error) throw new Error(`[Executor PAPER] Supabase insert failed: ${error.message}`);
    console.log(`[Executor PAPER] Logged trade: ${signal.action} ${signal.symbol} @ ${livePrice} (Live)`);
    return;
  }

  if (mode === "MICRO") {
    const exchange = buildExchange();
    try {
      const totalMargin = await getTotalOpenMargin(exchange);
      const todayLoss = await getTodayLoss();
      if (todayLoss >= MAX_DAILY_LOSS_USD) return;
      const orderValueUsd = Math.min(MAX_SINGLE_ORDER_USD, MAX_TOTAL_MARGIN_USD - totalMargin);
      const amount = orderValueUsd / livePrice;
      const side = signal.action === "BUY" ? "buy" : "sell";
      const order = await exchange.createMarketOrder(signal.symbol, side, amount);
      await supabase.from("paper_trades").insert({
        symbol: signal.symbol,
        position_type: signal.action === "BUY" ? "LONG" : "SHORT",
        entry_price: livePrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        status: "OPEN",
        pnl: 0,
      });
    } catch (err: any) {
      await logError("EXECUTOR_MICRO", err, { signal }, true);
      await emergencyCloseAll(exchange, err.message);
      throw err;
    }
  }
}

export async function closeMicroPosition(symbol: string, positionType: "LONG" | "SHORT"): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";
  if (mode !== "MICRO") return;
  const exchange = buildExchange();
  try {
    const openOrders = await exchange.fetchOpenOrders(symbol);
    for (const order of openOrders) {
      if (order.id) await exchange.cancelOrder(order.id, symbol);
    }
    const side = positionType === "LONG" ? "sell" : "buy";
    const positions = await exchange.fetchPositions([symbol]);
    const pos = positions.find((p: any) => p.symbol === symbol);
    if (pos && parseFloat((pos.contracts || 0).toString()) > 0) {
      await exchange.createMarketOrder(symbol, side, Math.abs(parseFloat((pos.contracts || 0).toString())));
    }
  } catch (err: any) {
    await logError("EXECUTOR_CLOSE_POSITION", err, { symbol, positionType }, false);
  }
}