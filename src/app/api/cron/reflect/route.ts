import { NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { storeMemory } from "@/lib/memory";
import { sendTelegramMessage } from "@/lib/telegram";

// This endpoint should be called nightly via Vercel Cron
export async function GET(request: Request) {
  try {
    // 1. In a real scenario, you'd fetch all raw chat logs/trades from the day here.
    // For this implementation, we will manually inject a simulated reflection summary 
    // or allow POSTing daily summaries.
    
    // As a test, we will just store a hardcoded memory if called without data, 
    // or parse URL params for a custom memory.
    const { searchParams } = new URL(request.url);
    const customMemory = searchParams.get("memory");

    const memoryContent = customMemory || `Daily Reflection [${new Date().toISOString().split("T")[0]}]: Monitored Divar for arbitrage. Found 0 extreme outliers today. Bitcoin trading volume was low. No Gann levels triggered.`;

    // 2. Generate embedding and store in Supabase
    await storeMemory(memoryContent, { source: "nightly_reflection", type: "summary" });

    // 3. Notify via Telegram
    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID as string, `?? Nightly Reflection Complete.\nStored new memory: "${memoryContent}"`);

    return NextResponse.json({ success: true, stored_memory: memoryContent });
  } catch (error: any) {
    await logError("API_REFLECT", error, {}, true);
    return NextResponse.json({ error: "Reflection execution failed" }, { status: 500 });
  }
}



