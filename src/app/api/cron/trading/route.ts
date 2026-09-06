import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { runTradingCycle } from "@/lib/trading/executor";
import { verifyQStashSignature } from "@/lib/qstash";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // External API calls may take time

export async function POST(req: NextRequest) {
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    return new NextResponse('Unauthorized: Invalid QStash Signature', { status: 401 });
  }

  try {
    const symbol = "BTC/USDT";
    
    console.log(`[Trading Engine] Initiating Pure Quant cycle for ${symbol}...`);
    
    // The executor now handles fetching data, evaluating SMC+Gann, and synchronous execution
    await runTradingCycle(symbol);

    return NextResponse.json({ 
      ok: true, 
      symbol, 
      message: "Trading cycle completed."
    });
  } catch (error: any) {
    await logError("API_TRADING", error, {}, true);
    return NextResponse.json({ error: "Trading execution failed" }, { status: 500 });
  }
}
