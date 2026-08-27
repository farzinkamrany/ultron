import { NextRequest, NextResponse } from "next/server";
import ccxt from "ccxt";
import { analyzeGannSetup, Candle } from "@/lib/trading/gann";
import { sendTelegramMessage } from "@/lib/telegram";
import { logError } from "@/lib/logger";
import { HttpsProxyAgent } from "https-proxy-agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // External API calls may take time

export async function GET(req: NextRequest) {
  try {
    // Vercel Cron security check
    const authHeader = req.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      if (process.env.NODE_ENV === "production") {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    // Initialize CCXT Exchange (Binance as default for high liquidity)
    const exchange = new ccxt.binance({ enableRateLimit: true });
    
    // Config proxy if needed for CCXT (since Binance is blocked in some regions including US/Iran)
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) {
      
      exchange.agent = new HttpsProxyAgent(proxyUrl);
    }

    const symbol = "BTC/USDT";
    const timeframe = "1d"; // Daily candles for macro Gann analysis
    
    console.log(`[Trading Engine] Fetching ${timeframe} candles for ${symbol}...`);
    
    // Fetch last 100 days
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 100);
    
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
    
    const signal = analyzeGannSetup(symbol, currentPrice, candles);

    if (signal.action !== "HOLD") {
      const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      
      const msg = `📈 <b>GANN TRADE SIGNAL ALARM</b> 📈\n\n` +
                  `<b>Asset:</b> ${signal.symbol}\n` +
                  `<b>Action:</b> ${signal.action}\n` +
                  `<b>Entry:</b> $${signal.entryPrice.toFixed(2)}\n` +
                  `<b>Stop-Loss:</b> $${signal.stopLoss.toFixed(2)}\n` +
                  `<b>Target:</b> $${signal.takeProfit.toFixed(2)}\n\n` +
                  `<i>${signal.reason}</i>`;
                  
      if (chatId) {
         await sendTelegramMessage(chatId, msg);
      }
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



