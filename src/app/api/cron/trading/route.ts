import { NextRequest, NextResponse } from "next/server";
import ccxt from "ccxt";
import { Candle } from "@/lib/trading/gann";
import { evaluateSetup } from "@/lib/trading/strategy";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import { supabase } from "@/lib/supabase";
import { executeTrade } from "@/lib/trading/executor";

import { verifyQStashSignature } from "@/lib/qstash";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // External API calls may take time

export async function POST(req: NextRequest) {
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    return new NextResponse('Unauthorized: Invalid QStash Signature', { status: 401 });
  }

  try {
    // Initialize CCXT Exchange (Kucoin to avoid IP blocks)
    const exchange = new ccxt.kucoin({ enableRateLimit: true });

    const symbol = "BTC/USDT";
    const timeframe = "15m"; // 15m candles for SMC+Gann analysis
    
    console.log(`[Trading Engine] Fetching ${timeframe} candles for ${symbol}...`);
    
    // Fetch last 100 days with robust error handling
    let ohlcv;
    try {
      ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 20);
    } catch (error: any) {
      // Handle ExchangeNotAvailable or HTTP 451 (Unavailable For Legal Reasons)
      if (error instanceof ccxt.ExchangeNotAvailable || error.message.includes('451') || error.message.includes('403')) {
        console.error(`[Trading Engine] Exchange access restricted or unavailable: ${error.message}`);
        await logError("API_TRADING_FETCH", error, { symbol }, false);
        return NextResponse.json({ error: "Exchange temporarily unavailable or restricted" }, { status: 503 });
      }
      throw error; // Re-throw unexpected errors
    }
    
    // Map CCXT format [timestamp, open, high, low, close, volume] to our interface
    const candles: Candle[] = ohlcv.map(c => ({
      timestamp: c[0] as number,
      open: c[1] as number,
      high: c[2] as number,
      low: c[3] as number,
      close: c[4] as number,
      volume: c[5] as number,
    }));

    if (candles.length === 0) {
      return NextResponse.json({ error: "No market data retrieved." }, { status: 500 });
    }

    const currentPrice = candles[candles.length - 1].close;
    
    console.log(`[Trading Engine] Current ${symbol} price: ${currentPrice}. Analyzing Gann structures...`);
    
    const signal = evaluateSetup(symbol, currentPrice, candles);

    if (signal.action !== "HOLD") {
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      
      const msg = `📈 <b>GANN TRADE SIGNAL ALARM</b> 📈

` +
                  `<b>Asset:</b> ${signal.symbol}
` +
                  `<b>Action:</b> ${signal.action}
` +
                  `<b>Entry:</b> $${signal.entryPrice.toFixed(2)}
` +
                  `<b>Stop-Loss:</b> $${signal.stopLoss.toFixed(2)}
` +
                  `<b>Target:</b> $${signal.takeProfit.toFixed(2)}

` +
                  `<i>${signal.reason}</i>`;
                  
      if (chatId) {
         await sendTelegramMessage(chatId, msg);
      }
      
      // Pass signal to the executor (handles both PAPER and MICRO modes)
      await executeTrade(signal);
    }

    return NextResponse.json({ 
      ok: true, 
      symbol, 
      currentPrice,
      action: signal.action 
    });
  } catch (error: any) {
    await logError("API_TRADING", error, {}, true);
    return NextResponse.json({ error: "Trading execution failed" }, { status: 500 });
  }
}
