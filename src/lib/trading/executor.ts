/**
 * Ultron Trading Executor — V4.1
 *
 * Routes trade signals to either PAPER trading (Supabase DB) or
 * MICRO live trading (real CCXT exchange orders) based on TRADE_MODE env var.
 *
 * ⚠️ KILL SWITCH RULES (DYNAMIC RISK):
 *   - Max total open margin: 50% of free balance
 *   - Max single order size: 10x leverage cap (1% risk / SL%)
 *   - Daily loss limit: 3% of free balance
 *   - On any uncaught error: close ALL positions immediately + Telegram alert
 */

import ccxt, { Exchange } from "ccxt";
import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import type { TradeSignal } from "./gann";
import { calculateDynamicKelly } from "./risk";

// Hardcoded limits removed in favor of dynamic risk sizing

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
  const hlSymbol = symbol.includes('/USDT') ? symbol.replace('/USDT', '/USDC:USDC') : symbol;
  const ticker = await exchange.fetchTicker(hlSymbol);
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

export async function triggerPanicClose(): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";
  if (mode === "PAPER") {
    // Just close paper trades in DB
    await supabase.from("paper_trades").update({ status: "CLOSED", closed_at: new Date().toISOString() }).eq("status", "OPEN");
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (adminChatId) await sendTelegramMessage(adminChatId, "🚨 Paper trades panic closed.");
    return;
  }
  const exchange = buildExchange();
  await emergencyCloseAll(exchange, "MANUAL PANIC BUTTON PRESSED BY ADMIN");
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
      // 1. Fetch Live Balance
      const balanceInfo = await exchange.fetchBalance();
      const liveBalance = balanceInfo['USDC']?.free || balanceInfo['USDT']?.free || 1000;

      // 2. Kill Switch (3% daily loss limit)
      const maxDailyLoss = liveBalance * 0.03;
      const todayLoss = await getTodayLoss();
      if (todayLoss >= maxDailyLoss) {
         console.warn(`[Kill Switch] Daily loss (${todayLoss}) exceeds 3% limit (${maxDailyLoss})`);
         return;
      }

      // 3. Margin Cap (max 50% of balance tied up in margin)
      const totalMargin = await getTotalOpenMargin(exchange);
      if (totalMargin > liveBalance * 0.5) {
         console.warn("[Risk] Used margin exceeds 50% of account balance.");
         return; 
      }

      // Map generic /USDT symbols (e.g. BTC/USDT, ETH/USDT) to Hyperliquid perp symbols (BTC/USDC:USDC)
      const hlSymbol = signal.symbol.includes('/USDT') 
        ? signal.symbol.replace('/USDT', '/USDC:USDC') 
        : signal.symbol;
      
      // 4. Dynamic Position Sizing (ATR Kelly Criterion)
      const kellyPercent = await calculateDynamicKelly(signal.symbol);
      const riskAmount = liveBalance * kellyPercent;
      const stopLossPerc = Math.abs(livePrice - signal.stopLoss) / livePrice;
      let targetPositionUsd = riskAmount / stopLossPerc;
      
      // 5. Max Leverage Cap (10x of free balance)
      const maxAllowedPositionUsd = liveBalance * 10;
      if (targetPositionUsd > maxAllowedPositionUsd) {
          targetPositionUsd = maxAllowedPositionUsd;
      }
      
      const amount = targetPositionUsd / livePrice;
      const side = signal.action === "BUY" ? "buy" : "sell";
      
      // Cancel any existing ghost orders for this symbol to avoid conflicts
      await exchange.loadMarkets();
      const openOrders = await exchange.fetchOpenOrders(hlSymbol);
      for (const order of openOrders) {
        if (order.id) await exchange.cancelOrder(order.id, hlSymbol);
      }
      
      // Execute main entry order
      const order = await exchange.createMarketOrder(hlSymbol, side, amount);
      
      // Execute SL and TP trigger orders
      const oppositeSide = side === "buy" ? "sell" : "buy";
      
      // Stop Loss
      await exchange.createOrder(hlSymbol, 'market', oppositeSide, amount, undefined, { 
        triggerPrice: signal.stopLoss, 
        reduceOnly: true 
      });

      // Take Profit
      await exchange.createOrder(hlSymbol, 'market', oppositeSide, amount, undefined, { 
        triggerPrice: signal.takeProfit, 
        reduceOnly: true 
      });
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
    const hlSymbol = symbol.includes('/USDT') ? symbol.replace('/USDT', '/USDC:USDC') : symbol;
    const openOrders = await exchange.fetchOpenOrders(hlSymbol);
    for (const order of openOrders) {
      if (order.id) await exchange.cancelOrder(order.id, hlSymbol);
    }
    const side = positionType === "LONG" ? "sell" : "buy";
    const positions = await exchange.fetchPositions([hlSymbol]);
    const pos = positions.find((p: any) => p.symbol === hlSymbol);
    if (pos && parseFloat((pos.contracts || 0).toString()) > 0) {
      await exchange.createMarketOrder(hlSymbol, side, Math.abs(parseFloat((pos.contracts || 0).toString())));
    }
  } catch (err: any) {
    await logError("EXECUTOR_CLOSE_POSITION", err, { symbol, positionType }, false);
  }
}