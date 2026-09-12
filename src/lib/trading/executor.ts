/**
 * Ultron Trading Executor — V5.0 (Pure Quant)
 *
 * Routes trade signals to either PAPER trading (Supabase DB) or
 * MICRO live trading (real CCXT exchange orders).
 * 
 * Strict execution sequence:
 * 1. Hyperliquid Order
 * 2. Supabase Logging
 * 3. VIP Telegram Broadcast (LLM PR)
 */

import ccxt, { Exchange } from "ccxt";
import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import { calculateDynamicKelly } from "./risk";
import { Candle, detectRegime } from "./financial-intelligence";
import { evaluateSetup } from "./strategy";
import { analyzeDerivatives } from "./derivatives";
import { TradeSignal as SetupSignal } from "./gann";
import { GoogleGenerativeAI } from "@google/generative-ai";

export function buildExchange() {
  const exchange = new ccxt.hyperliquid({
    walletAddress: process.env.HYPERLIQUID_WALLET || "",
    privateKey: process.env.HYPERLIQUID_PRIVATE_KEY || "",
    enableRateLimit: true,
    options: {
      defaultType: 'swap',
    }
  });
  return exchange;
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
        `🚨 <b>ULTRON KILL SWITCH ACTIVATED</b> 🚨\n\n<b>Reason:</b> ${reason}\n\nAll open positions have been cancelled immediately.`
      );
    }
  } catch (err: any) {
    console.error("[Kill Switch] Failed to close positions:", err.message);
  }
}

export async function triggerPanicClose(): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";
  if (mode === "PAPER") {
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
    return positions.reduce((sum: number, p: any) => sum + Math.abs(parseFloat(p.initialMargin || p.notional || 0)), 0);
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

async function broadcastVipSignal(signal: SetupSignal, livePrice: number) {
  const vipChannelId = process.env.TELEGRAM_VIP_CHANNEL_ID;
  if (!vipChannelId) return;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `You are the PR manager for Ultron, an elite quantitative trading bot. 
    Write a highly professional, engaging, and exciting VIP Telegram message for a new trade that was just executed.
    
    Trade Details:
    - Asset: ${signal.symbol}
    - Action: ${signal.action} (LONG or SHORT)
    - Entry Price: $${livePrice.toFixed(4)}
    - Take Profit: $${signal.takeProfit.toFixed(4)}
    - Stop Loss: $${signal.stopLoss.toFixed(4)}
    
    The message must include these exact numbers, use emojis tastefully, and highlight that this was driven by our Pure Quant Engine (SMC + Gann).
    Do NOT include any markdown code blocks, just raw text ready for Telegram. Keep it concise.`;

    const result = await model.generateContent(prompt);
    let msg = result.response.text().trim();

    await sendTelegramMessage(vipChannelId, msg);
  } catch (err: any) {
    console.error("[VIP Signal] LLM/Broadcast failed, falling back to standard format:", err.message);
    const type = signal.action === "BUY" ? "🟢 LONG" : "🔴 SHORT";
    const msg = `💎 **ULTRON VIP SIGNAL (QUANT)** 💎\n🔹 Asset: #${signal.symbol.replace(/[^a-zA-Z0-9]/g, '')}\n🔹 Action: ${type}\n🔹 Entry: $${livePrice.toFixed(4)}\n🎯 TP: $${signal.takeProfit.toFixed(4)}\n⛔️ SL: $${signal.stopLoss.toFixed(4)}`;
    await sendTelegramMessage(vipChannelId, msg);
  }
}

export async function runTradingCycle(symbol: string = "BTC/USDT"): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";
  
  // Data Fetching via Kucoin (for clean OHLCV data without IP limits)
  const dataExchange = new ccxt.kucoin({ enableRateLimit: true });
  
  let ohlcv15m, ohlcv1h;
  try {
    ohlcv15m = await dataExchange.fetchOHLCV(symbol, "15m", undefined, 20);
    ohlcv1h = await dataExchange.fetchOHLCV(symbol, "1h", undefined, 365); // need 200 for EMA
  } catch (error: any) {
    console.error(`[Trading Engine] Data fetch failed: ${error.message}`);
    await logError("API_TRADING_FETCH", error, { symbol }, false);
    return;
  }
  
  const mapCandles = (ohlcv: any[]): Candle[] => ohlcv.map(c => ({
    timestamp: c[0] as number,
    open: c[1] as number,
    high: c[2] as number,
    low: c[3] as number,
    close: c[4] as number,
    volume: c[5] as number,
  }));
  
  const candles15m = mapCandles(ohlcv15m);
  const candles1h = mapCandles(ohlcv1h);
  
  if (candles15m.length < 5 || candles1h.length < 200) {
    console.warn(`[Trading Engine] Insufficient data. 15m: ${candles15m.length}, 1h: ${candles1h.length}`);
    return;
  }
  
  const livePrice = candles15m[candles15m.length - 1].close;
  
  // Regime-Based Concurrency
  const regime = detectRegime(candles1h);
  const maxConcurrentTrades = regime === 'TRENDING' ? 8 : 3;
  console.log(`[Regime] Current Market Regime: ${regime}. Max Concurrency set to ${maxConcurrentTrades}.`);

  // Fetch Micro-Structure Data (Funding Rates & BTC.D)
  const derivs = await analyzeDerivatives(symbol);
  const marketContext = { 
      fundingRate: derivs.fundingRate, 
      btcDominanceTrend: derivs.btcDominanceTrend
  };

  // Engine Evaluation
  const signal = await evaluateSetup(symbol, livePrice, candles15m, candles1h, regime, marketContext);
  console.log(`[Quant Engine] Setup evaluated: ${signal.action}. Reason: ${signal.reason || 'Valid setup'}`);
  
  if (signal.action === "HOLD") return;

  // Cooldown & Open Trade Check: Prevent concurrent trades on same symbol and revenge trading
  const { data: openTrades } = await supabase
    .from("paper_trades")
    .select("*")
    .eq("symbol", signal.symbol)
    .eq("status", "OPEN");

  if (openTrades && openTrades.length > 0) {
    console.log(`[Cooldown] Skipping ${signal.symbol} - an OPEN trade already exists.`);
    return;
  }

  const cooldownLimit = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15-minute cooldown (Machine speed, no human fear)
  const { data: recentTrades } = await supabase
    .from("paper_trades")
    .select("*")
    .eq("symbol", signal.symbol)
    .gte("created_at", cooldownLimit);

  if (recentTrades && recentTrades.length > 0) {
    console.log(`[Cooldown] Skipping ${signal.symbol} - a trade was placed in the last 15 minutes.`);
    return;
  }

  // Execution Phase
  if (mode === "PAPER") {
    // Check concurrent trades
    const { data: openTrades } = await supabase.from("paper_trades").select("*").eq("status", "OPEN");
    if (openTrades) {
      if (openTrades.length >= maxConcurrentTrades) {
        console.log(`[Margin] Skipping ${signal.symbol} - MAX_CONCURRENT_TRADES (${maxConcurrentTrades}) reached.`);
        return;
      }
      if (openTrades.some(t => t.symbol === signal.symbol)) {
        console.log(`[Margin] Skipping ${signal.symbol} - Already have an open trade for this symbol.`);
        return;
      }
    }

    // 1. (Simulated) Exchange Order
    // 2. Database Insert
    const { error } = await supabase.from("paper_trades").insert({
      symbol: signal.symbol,
      position_type: signal.action,
      entry_price: livePrice,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      status: "OPEN",
      pnl: 0,
    });
    if (error) {
      console.error(`[Executor PAPER] Supabase insert failed: ${error.message}`);
      return;
    }
    
    // 3. Telegram VIP Broadcast
    console.log(`[Executor PAPER] Logged trade: ${signal.action} ${signal.symbol} @ ${livePrice}`);
    await broadcastVipSignal(signal, livePrice);
    return;
  }

  if (mode === "MICRO") {
    const exchange = buildExchange();
    try {
      const balanceInfo = await exchange.fetchBalance();
      const liveBalance = balanceInfo['USDC']?.free || balanceInfo['USDT']?.free || 1000;

      // Kill Switch (3% daily loss) removed: the bot has no feelings and should keep trading.

      const totalMargin = await getTotalOpenMargin(exchange);
      if (totalMargin > liveBalance * 0.5) {
         console.warn("[Risk] Used margin exceeds 50% of account balance.");
         return; 
      }

      await exchange.loadMarkets();
      
      // Margin Allocation Limit Check
      const positions = await exchange.fetchPositions();
      const activePositions = positions.filter((p: any) => Math.abs(p.contracts || 0) > 0);
      
      if (activePositions.length >= maxConcurrentTrades) {
        console.warn(`[Margin] Skipping ${signal.symbol} - Max concurrent trades (${maxConcurrentTrades}) reached on exchange.`);
        return;
      }
      if (activePositions.some((p: any) => p.symbol === signal.symbol)) {
        console.warn(`[Margin] Skipping ${signal.symbol} - Already holding position for this symbol.`);
        return;
      }
      
      const kellyPercent = await calculateDynamicKelly(signal.symbol);
      const riskAmount = liveBalance * kellyPercent;
      const stopLossPerc = Math.abs(livePrice - signal.stopLoss) / livePrice;
      let targetPositionUsd = riskAmount / stopLossPerc;
      
      const maxAllowedPositionUsd = liveBalance * 10;
      if (targetPositionUsd > maxAllowedPositionUsd) {
          targetPositionUsd = maxAllowedPositionUsd;
      }
      
      const amount = targetPositionUsd / livePrice;
      const side = signal.action === "BUY" ? "buy" : "sell";
      
      await exchange.loadMarkets();
      const openOrders = await exchange.fetchOpenOrders(signal.symbol);
      for (const order of openOrders) {
        if (order.id) await exchange.cancelOrder(order.id, signal.symbol);
      }
      
      // 1. EXCHANGE EXECUTION
      if (signal.executionType === 'LIMIT') {
          await exchange.createOrder(signal.symbol, 'limit', side, amount, signal.entryPrice, { postOnly: true });
      } else {
          // Capitulation - Use IOC Limit to prevent extreme slippage (0.1% max buffer)
          const limitPrice = side === 'buy' ? livePrice * 1.001 : livePrice * 0.999;
          await exchange.createOrder(signal.symbol, 'limit', side, amount, limitPrice, { timeInForce: 'IOC' });
      }
      
      const oppositeSide = side === "buy" ? "sell" : "buy";
      try {
        // Stop-Limit instead of Stop-Market (0.2% limit buffer)
        const slLimitPrice = oppositeSide === "sell" ? signal.stopLoss * 0.998 : signal.stopLoss * 1.002;
        await exchange.createOrder(signal.symbol, 'limit', oppositeSide, amount, slLimitPrice, { triggerPrice: signal.stopLoss, reduceOnly: true });
      } catch (slError: any) {
        // FATAL: The market order went through but the stop loss failed. NAKED POSITION!
        console.error(`[CRITICAL SHIELD] Failed to set Stop Loss for ${signal.symbol}. Panic closing naked position. Error: ${slError.message}`);
        try {
          await exchange.createMarketOrder(signal.symbol, oppositeSide, amount);
          console.log(`[CRITICAL SHIELD] Successfully panic closed naked position for ${signal.symbol}.`);
        } catch (panicError: any) {
          console.error(`[CRITICAL SHIELD] FATAL: Failed to panic close naked position for ${signal.symbol}. MANUAL INTERVENTION REQUIRED! Error: ${panicError.message}`);
        }
        throw new Error(`Execution aborted: Failed to secure position with Stop Loss. Panic closed to prevent liquidation.`);
      }
      
      // ❌ HUMAN EMOTION REMOVED: No Hard Take-Profit order. 
      // A machine doesn't say "I'm satisfied with this profit." It trails the Stop-Loss until the trend dies.
      
      // 2. SUPABASE LOGGING
      const { error } = await supabase.from("paper_trades").insert({
        symbol: signal.symbol,
        position_type: signal.action,
        entry_price: livePrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        status: "OPEN",
        pnl: 0,
      });

      if (error) {
        throw new Error(`[Executor MICRO] Supabase insert failed: ${error.message}`);
      }

      // 3. TELEGRAM VIP BROADCAST
      await broadcastVipSignal(signal, livePrice);
    } catch (err: any) {
      await logError("EXECUTOR_MICRO", err, { signal }, true);
      await emergencyCloseAll(exchange, err.message);
    }
  }
}

export async function closeMicroPosition(symbol: string, positionType: "BUY" | "SELL"): Promise<void> {
  const mode = process.env.TRADE_MODE || "PAPER";
  if (mode !== "MICRO") return;
  const exchange = buildExchange();
  try {
    const openOrders = await exchange.fetchOpenOrders(symbol);
    for (const order of openOrders) {
      if (order.id) await exchange.cancelOrder(order.id, symbol);
    }
    const side = positionType === "BUY" ? "sell" : "buy";
    const positions = await exchange.fetchPositions([symbol]);
    const pos = positions.find((p: any) => p.symbol === symbol);
    if (pos && parseFloat((pos.contracts || 0).toString()) > 0) {
      await exchange.createMarketOrder(symbol, side, Math.abs(parseFloat((pos.contracts || 0).toString())));
    }
  } catch (err: any) {
    await logError("EXECUTOR_CLOSE_POSITION", err, { symbol, positionType }, false);
  }
}