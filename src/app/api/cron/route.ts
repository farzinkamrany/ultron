import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai';
import { sendTelegramMessage } from '@/lib/telegram';
import { logSystemEvent } from '@/lib/ultron-db';
import { verifyQStashSignature } from '@/lib/qstash';
import ccxt from 'ccxt';
import { calculateGannSquareOf9 } from '@/lib/trading/gann';
import { HttpsProxyAgent } from 'https-proxy-agent';

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow 60s for external API + LLM generation

export async function POST(request: NextRequest) {
  // In local development, bypass QStash verification so you can test via browser
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    const isValid = await verifyQStashSignature(request);
    if (!isValid) {
      return new NextResponse('Unauthorized: Invalid QStash Signature', { status: 401 });
    }
  }

  try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    let dispatcher: any = undefined;
    if (proxyUrl) {
      const { ProxyAgent } = require('undici');
      dispatcher = new ProxyAgent(proxyUrl);
    }

    // 1. Fetch Macro Sentiment (Fear & Greed Index)
    let fearGreedValue = "Unknown";
    let fearGreedClass = "Unknown";
    try {
      const fgRes = await fetch("https://api.alternative.me/fng/?limit=1", { dispatcher } as RequestInit);
      const fgData = await fgRes.json();
      if (fgData && fgData.data && fgData.data.length > 0) {
        fearGreedValue = fgData.data[0].value;
        fearGreedClass = fgData.data[0].value_classification;
      }
    } catch (e) {
      console.warn("[Cron] Failed to fetch Fear & Greed:", e);
    }

    // 2. Initialize CCXT with Proxy (if needed in local env)
    const exchange = new ccxt.binance({ enableRateLimit: true });
    if (proxyUrl) {
      exchange.agent = new HttpsProxyAgent(proxyUrl);
    }

    // 3. Fetch Top Liquid Coins (BTC & ETH) Data & Gann Levels
    const symbols = ["BTC/USDT", "ETH/USDT"];
    let marketDataStr = "";

    for (const symbol of symbols) {
      try {
        const ticker = await exchange.fetchTicker(symbol);
        const currentPrice = ticker.last || 0;
        const volume24h = ticker.quoteVolume || 0;
        const change24h = ticker.percentage || 0;

        // Fetch daily candles to get the recent major bottom for Gann
        const ohlcv = await exchange.fetchOHLCV(symbol, "1d", undefined, 60); // 60 days
        let lowest = Infinity;
        for (const c of ohlcv) {
          if (c && c[3] !== undefined && c[3] < lowest) lowest = c[3]; // c[3] is Low
        }

        const gann = calculateGannSquareOf9(lowest);
        // Find nearest Gann support and resistance relative to current price
        const closestSupport = [...gann.supports].reverse().find(s => currentPrice >= s) || gann.supports[0];
        const closestResistance = gann.resistances.find(r => currentPrice <= r) || gann.resistances[gann.resistances.length - 1];

        marketDataStr += `
Asset: ${symbol}
Current Price: $${currentPrice.toFixed(2)}
24h Change: ${change24h.toFixed(2)}%
24h Volume: $${Math.floor(volume24h).toLocaleString()}
W.D. Gann Nearest Support: $${closestSupport.toFixed(2)}
W.D. Gann Nearest Resistance: $${closestResistance.toFixed(2)}
---`;
      } catch (err: any) {
        console.warn(`[Cron] CCXT fetch failed for ${symbol}:`, err.message);
      }
    }

    // 4. Construct AI Prompt combining Strict Rules + Hard Data
    const prompt = `System Directive: You are Ultron, Farzin's Elite Quantitative Financial Strategist.
Task: Analyze the provided LIVE hard data and formulate EXACTLY 2 high-probability trade setups (one for each provided asset).

[LIVE HARD DATA INJECTED BY CRON]
Macro Sentiment (Fear & Greed): ${fearGreedValue}/100 (${fearGreedClass})
${marketDataStr}

CRITICAL STRATEGY (W.D. GANN CONFLUENCE): 
Your goal is capital preservation and extremely high win rate. Use the exact W.D. Gann Support/Resistance levels provided above to determine logical Entry, Target (TP), and Stop-Loss (SL) points. Do NOT invent prices; align your strategy with the mathematical Gann levels and current market sentiment.

Keep it ultra-clean, scannable, and free of headache-inducing jargon. NO walls of text. 
Format EXACTLY like this for each coin:

🚀 [Coin Name/Ticker]
💡 دلیل: [One short, highly technical sentence referencing the Gann level and sentiment]
🟢 ورود (Buy): [Price]
🎯 تارگت (TP): [Price]
🔴 حد ضرر (SL): [Price]

CRITICAL: Write entirely in Persian (فارسی). Give only the direct numbers and the core reason. No extra fluff, greetings, or disclaimers.`;

    const aiResponse = await generateAIResponse([
      { role: 'user', content: prompt }
    ]);

    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not defined');
    }

    await sendTelegramMessage(chatId, aiResponse);
    await logSystemEvent('info', 'Autonomous Quant Analyst executed', { target: 'telegram', content: aiResponse });

    return NextResponse.json({ success: true, message: 'Autonomous Analyst executed successfully' });
  } catch (error: any) {
    console.error('Autonomous Analyst Error:', error);
    await logSystemEvent('error', 'Autonomous Analyst Error', { error: error.message });
    return NextResponse.json({ success: false, error: error.message, stack: error.stack }, { status: 500 });
  }
}

// Allow GET requests for easy manual testing in the browser
export async function GET(request: NextRequest) {
  return POST(request);
}
