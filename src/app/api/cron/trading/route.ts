import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { runTradingCycle } from "@/lib/trading/executor";
import { verifyQStashSignature } from "@/lib/qstash";
import { getTopVolatileSymbols } from "@/lib/trading/screener";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // External API calls may take time

export async function POST(req: NextRequest) {
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    return new NextResponse('Unauthorized: Invalid QStash Signature', { status: 401 });
  }

  try {
    const symbols = await getTopVolatileSymbols();
    
    console.log(`[Trading Engine] Sweeping 10-coin pool...`);
    
    for (const sym of symbols) {
       console.log(`[Trading Engine] Checking ${sym}...`);
       try {
         await runTradingCycle(sym);
       } catch (err: any) {
         console.error(`[Trading Engine] Error on ${sym}: ${err.message}`);
       }
    }

    return NextResponse.json({ 
      ok: true, 
      message: "10-Coin sweep completed."
    });
  } catch (error: any) {
    await logError("API_TRADING", error, {}, true);
    return NextResponse.json({ error: "Trading execution failed" }, { status: 500 });
  }
}
