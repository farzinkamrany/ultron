import { NextRequest, NextResponse } from "next/server";
import { fetchDivarAds, detectArbitrageOpportunities } from "@/lib/divar";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow enough time for scraping

export async function GET(req: NextRequest) {
  try {
    // Vercel Cron security check
    const authHeader = req.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      // Return 401 if unauthorized, but skip check if secret not set for local testing
      if (process.env.NODE_ENV === "production") {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const city = "tehran";
    // Target high-liquidity category
    const category = "mobile-phones"; 

    console.log(`[Arbitrage Engine] Fetching ads for ${category} in ${city}...`);
    const ads = await fetchDivarAds(city, category);
    
    if (ads.length === 0) {
      return NextResponse.json({ status: "No valid ads parsed" });
    }

    console.log(`[Arbitrage Engine] Parsed ${ads.length} ads. Calculating Z-scores...`);
    const opportunities = detectArbitrageOpportunities(ads);

    if (opportunities.length > 0) {
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      
      for (const opp of opportunities) {
        // Check if we already alerted this ad recently
        const { data: existing } = await supabase
          .from("arbitrage_alerts")
          .select("id")
          .eq("token", opp.token)
          .single();
          
        if (!existing) {
          // Send Alert
          const msg = `🚨 <b>ARBITRAGE OPPORTUNITY DETECTED</b> 🚨\n\n` +
                      `<b>Title:</b> ${opp.title}\n` +
                      `<b>Price:</b> ${opp.price.toLocaleString("fa-IR")} Toman\n` +
                      `<b>Z-Score:</b> < -1.5 (Significantly Underpriced!)\n\n` +
                      `<a href="${opp.url}">View Ad on Divar</a>`;
                      
          if (chatId) {
             await sendTelegramMessage(chatId, msg);
          }
          
          // Log to Supabase to prevent duplicate alerts
          await supabase.from("arbitrage_alerts").insert([{ token: opp.token, details: opp }]);
        }
      }
    }

    return NextResponse.json({ 
      ok: true, 
      scanned: ads.length, 
      opportunities_found: opportunities.length 
    });
  } catch (error: any) {
    await logError("API_ARBITRAGE", error, {}, true);
    return NextResponse.json({ error: "Arbitrage execution failed" }, { status: 500 });
  }
}


