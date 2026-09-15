import { supabase } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import { fetchForexOHLCV } from "./forex-data";
import { evaluateForexSetup } from "./kraken";
import { detectRegime } from "./financial-intelligence";
import { TradeSignal } from "./gann";

/**
 * Project Kraken: Forex Executor
 * Runs the Forex strategy pipeline. Currently strictly PAPER TRADING.
 */
export async function runForexCycle(symbol: string = "EUR/USD"): Promise<void> {
    try {
        // 1. Fetch Data
        const candles15m = await fetchForexOHLCV(symbol, "15m", 200);
        const candles1h = await fetchForexOHLCV(symbol, "1h", 200);
        
        if (candles15m.length < 5 || candles1h.length < 200) {
            console.warn(`[Kraken Engine] Insufficient data for ${symbol}.`);
            return;
        }

        const livePrice = candles15m[candles15m.length - 1].close;
        const regime = detectRegime(candles1h);
        const maxConcurrentTrades = 2; // Strict for Forex

        // 2. Evaluate Strategy
        const signal = await evaluateForexSetup(symbol, livePrice, candles15m, candles1h, regime);
        console.log(`[Kraken Engine] Setup evaluated: ${signal.action}. Reason: ${signal.reason || 'Valid setup'}`);
        
        if (signal.action === "HOLD") return;

        // 3. Cooldown & Open Trade Check
        const { data: openTrades } = await supabase
            .from("paper_trades")
            .select("*")
            .eq("symbol", signal.symbol)
            .eq("status", "OPEN");

        if (openTrades && openTrades.length > 0) {
            console.log(`[Kraken Cooldown] Skipping ${signal.symbol} - an OPEN trade already exists.`);
            return;
        }

        const cooldownLimit = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); 
        const { data: recentTrades } = await supabase
            .from("paper_trades")
            .select("*")
            .eq("symbol", signal.symbol)
            .gte("created_at", cooldownLimit);

        if (recentTrades && recentTrades.length > 0) {
            console.log(`[Kraken Cooldown] Skipping ${signal.symbol} - a trade was placed recently.`);
            return;
        }

        // 4. Paper Trade Execution
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
            console.error(`[Kraken Executor] Supabase insert failed: ${error.message}`);
            return;
        }

        // 5. Broadcast Signal
        console.log(`[Kraken Executor] Logged trade: ${signal.action} ${signal.symbol} @ ${livePrice}`);
        await broadcastForexSignal(signal, livePrice);

    } catch (error: any) {
        console.error(`[Kraken Executor] Cycle failed: ${error.message}`);
        await logError("KRAKEN_EXECUTOR", error, { symbol }, false);
    }
}

async function broadcastForexSignal(signal: TradeSignal, livePrice: number) {
    const vipChannelId = process.env.TELEGRAM_VIP_CHANNEL_ID;
    if (!vipChannelId) return;

    const type = signal.action === "BUY" ? "🟢 LONG (BUY)" : "🔴 SHORT (SELL)";
    const msg = `🌊 **KRAKEN FOREX SIGNAL** 🌊\n🔹 Asset: #${signal.symbol.replace(/[^a-zA-Z0-9]/g, '')}\n🔹 Action: ${type}\n🔹 Entry: ${livePrice.toFixed(5)}\n🎯 TP: ${signal.takeProfit.toFixed(5)}\n⛔️ SL: ${signal.stopLoss.toFixed(5)}\n🧠 Logic: ${signal.reason}`;
    
    try {
        await sendTelegramMessage(vipChannelId, msg);
    } catch (err: any) {
        console.error("[Kraken Signal] Broadcast failed:", err.message);
    }
}
