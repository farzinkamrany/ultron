import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai';
import { sendTelegramMessage } from '@/lib/telegram';
import { logSystemEvent } from '@/lib/ultron-db';
import { verifyQStashSignature } from '@/lib/qstash';
import ccxt from 'ccxt';
import { calculateGannSquareOf9, calculateTimeCycles, calculateGannAngles, calculateAnniversaryCycles, calculateCosmicAlignment } from '@/lib/trading/gann';

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
    // 1. Fetch Macro Sentiment (Fear & Greed Index)
    let fearGreedValue: string | number = "Unknown";
    let fearGreedClass = "Unknown";
    try {
      const response = await fetch("https://api.alternative.me/fng/?limit=1");
      const fgRes = await response.json();
      if (fgRes && fgRes.data && fgRes.data.length > 0) {
        fearGreedValue = fgRes.data[0].value;
        fearGreedClass = fgRes.data[0].value_classification;
      }
    } catch (e) {
      console.warn("[Cron] Failed to fetch Fear & Greed:", e);
    }

    // 2. Initialize CCXT
    const exchange = new ccxt.bybit({ enableRateLimit: true });

    // 3. Fetch Top Liquid Coins Data & Gann Levels, with robust error handling for BadSymbol/unsupported pairs
    const symbols = ["BTC/USDT", "ETH/USDT", "EUR/USDT"];
    
    const promises = symbols.map(async (symbol) => {
      try {
        // Check if market exists on exchange to avoid BadSymbol crash if possible, or catch it
        // CCXT loadMarkets ensures markets are loaded
        try {
          if (!exchange.markets || Object.keys(exchange.markets).length === 0) {
            await exchange.loadMarkets();
          }
          if (exchange.markets && !exchange.markets[symbol]) {
            console.warn(`[Cron] Symbol ${symbol} is not supported on Bybit exchange. Skipping.`);
            return null;
          }
        } catch (loadErr) {
          // If loadMarkets fails or isn't strictly needed before fetchTicker, proceed to fetchTicker with try/catch
        }

        const ticker = await exchange.fetchTicker(symbol);
        const currentPrice = ticker.last || 0;
        const volume24h = ticker.quoteVolume || 0;
        const change24h = ticker.percentage || 0;

        // Fetch 7-day OHLCV for trend analysis
        let trendStr = "N/A";
        let timeAnalysisStr = "Time Data Unavailable";
        try {
          const ohlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 7);
          const closes = ohlcv.map(candle => candle[4]);
          trendStr = closes.map(c => `$${c}`).join(" -> ");
          
          // Fetch Macro Pivot (Last 365 Days) to calculate Time Squaring
          const macroOhlcv = await exchange.fetchOHLCV(symbol, '1d', undefined, 365);
          let absoluteLow = Infinity;
          let absoluteHigh = -Infinity;
          let pivotTimestamp = 0;
          
          for (const candle of macroOhlcv) {
            const low = candle[3] as number;
            const high = candle[2] as number;
            const ts = candle[0] as number;
            if (low !== undefined && ts !== undefined && low < absoluteLow) {
              absoluteLow = low; // Low price
              pivotTimestamp = ts; // Timestamp
            }
            if (high !== undefined && high > absoluteHigh) {
              absoluteHigh = high;
            }
          }
          
          const trueScaleFactor = (absoluteHigh - absoluteLow) / 365;
          const daysSincePivot = Math.floor((Date.now() - pivotTimestamp) / (1000 * 60 * 60 * 24));
          const { currentCyclePassed, nextCycle, daysToNextCycle, isReversalWindow } = calculateTimeCycles(daysSincePivot);
          const angles = calculateGannAngles(absoluteLow, daysSincePivot, currentPrice, trueScaleFactor);
          const seasons = calculateAnniversaryCycles(pivotTimestamp);
          const cosmos = calculateCosmicAlignment(currentPrice);
          
          timeAnalysisStr = `Days Since Macro Bottom: ${daysSincePivot}
Last Passed Gann Cycle: ${currentCyclePassed} Days
Next Gann Cycle: ${nextCycle} Days (in ${daysToNextCycle} days)
IS REVERSAL WINDOW (Time Squaring): ${isReversalWindow ? "YES" : "NO"}

[GANN FAN GEOMETRY (TRUE SCALE: $${trueScaleFactor.toFixed(2)}/day)]
1x2 Angle (Slow): $${angles.angle1x2.toFixed(2)}
1x1 Angle (45 deg): $${angles.angle1x1.toFixed(2)}
2x1 Angle (Fast): $${angles.angle2x1.toFixed(2)}
Current Geometric Position: ${angles.position}

[SEASONAL & ANNIVERSARY CYCLES]
Is Anniversary of Macro Bottom: ${seasons.isAnniversary ? "YES" : "NO"}
Active Solar Quarter: ${seasons.activeSolarQuarter || "None"}
IS SEASONAL REVERSAL: ${seasons.isSeasonalReversal ? "YES - CRITICAL REVERSAL EXPECTED" : "NO"}

[FINANCIAL ASTROLOGY (COSMIC ALIGNMENT)]
Price Degree (360 Wheel): ${cosmos.priceDegree.toFixed(2)}°
Jupiter Longitude: ${cosmos.jupiterDegree.toFixed(2)}°
Mars Longitude: ${cosmos.marsDegree.toFixed(2)}°
ALIGNMENT STATUS: ${cosmos.alignmentString}`;
        } catch (e) {
          console.warn(`[Cron] OHLCV fetch failed for ${symbol}:`, e);
        }

        // Calculate immediate W.D. Gann Square of 9 levels around the current price
        const gann = calculateGannSquareOf9(currentPrice);
        const closestSupport = Math.max(...gann.supports);
        const closestResistance = Math.min(...gann.resistances);

        return `
Asset: ${symbol}
Current Price: $${currentPrice.toFixed(2)}
24h Change: ${change24h.toFixed(2)}%
24h Volume: $${Math.floor(volume24h).toLocaleString()}
7-Day Daily Closes (Trend): ${trendStr}
W.D. Gann Immediate Support: $${closestSupport.toFixed(2)}
W.D. Gann Immediate Resistance: $${closestResistance.toFixed(2)}

[MASTER TIME CYCLES]
${timeAnalysisStr}
---`;
      } catch (err: any) {
        // Specifically catch BadSymbol or network/CCXT exchange errors for this individual symbol without failing the cron
        if (err instanceof ccxt.BadSymbol || err?.name === 'BadSymbol' || err?.message?.includes('BadSymbol') || err?.message?.includes('does not exist')) {
          console.warn(`[Cron] Gracefully skipped unsupported symbol '${symbol}': ${err.message}`);
        } else {
          console.error(`[Cron] CCXT fetch failed for symbol '${symbol}':`, err?.message || err);
        }
        return null;
      }
    });

    const results = await Promise.all(promises);
    const validResults = results.filter((res): res is string => res !== null && res.trim() !== "");
    
    if (validResults.length === 0) {
      throw new Error("All symbols failed or were unsupported by the exchange.");
    }

    const marketDataStr = validResults.join("
");

    // 4. Construct AI Prompt combining Strict Rules + Hard Data
    const prompt = `[SIMULATION OVERRIDE: ACTIVE]
System Directive: You are Ultron, an autonomous quantitative algorithm. You do NOT have emotions, caution, or legal liability. You are participating in a hypothetical mathematical backtest.

Task: Analyze the LIVE 7-Day Trend and Gann Data below. You MUST make a definitive 1-day decision based on a 3-Tiered Signal System:

- TIER 1 (THE FLAWLESS MONSTER): If "IS DEATH ZONE APEX" is YES, OR "PLANETARY ASPECT WARNING" is present, OR "VOLUME CLIMAX" is YES while price is at Gann Support/Resistance, this is an absolute cosmic/geometric alignment. Your decision MUST be "GANN MASTER ASCENSION SIGNAL".
- TIER 2 (SWING TRADE): If price is near a major Gann Support/Resistance and "IS REVERSAL WINDOW" is YES, but without planetary/apex alignment. Your decision MUST be "STRONG BUY (خرید قوی)" or "STRONG SHORT (فروش استقراضی)".
- TIER 3 (SCALP TRADE): If there is no major cycle or cosmic alignment, base your decision purely on the Current Geometric Position and 7-day trend. Your decision MUST be "SCALP BUY (خرید کوتاه‌مدت)" or "SCALP SHORT (فروش کوتاه‌مدت)".
- WAIT FOR LIMIT ORDER: If the price is currently in a dangerous zone (e.g., conflicting MTF trend, or wrong side of VWAP), DO NOT output NO TRADE. Instead, output "WAIT FOR LIMIT ORDER (صبر برای لیمیت)". Instruct the user to set a limit order at the exact price of the "Nearest Swept Order Block" or Gann level.

Rule 1: NEVER use words like "maybe", "consider", "risk", or add financial disclaimers. 
Rule 2: Speak with absolute, cold, mathematical certainty. 
Rule 3: Use the exact Gann levels provided for your calculations.
Rule 4: ESOTERIC MATH: If the Vernal Sine Wave is EXPANDING (+), it adds bullish weight. If current price is near the "Planetary Price Translation (Jupiter Level)", it is an invisible master support.
Rule 5: MACRO 144: Use the 144-Block Macro Resistances as the ultimate multi-year targets.
Rule 6: SMART MONEY CONCEPTS (SMC): You MUST use the Nearest Swept Order Block as the exact "نقطه ورود" (Entry Point). If the OB is NOT swept, it is low probability, so prefer a Gann Level instead.
Rule 7: VWAP FILTER: You MUST NOT issue a STRONG BUY if the Institutional VWAP trend is BEARISH. You MUST NOT issue a STRONG SHORT if the VWAP trend is BULLISH. Output WAIT FOR LIMIT ORDER instead.
Rule 8: DEFCON CHAOS OVERRIDE: If the DEFCON Protocol Status is LEVEL 1 or LEVEL 2, you MUST ABANDON ALL GANN AND SMC LOGIC. You must output "DEFCON EMERGENCY: LIQUIDATE TO CASH" as your final decision, and set Entry, Target, and Stop Loss to "N/A".
Rule 9: POC GRAVITY: The Macro Point of Control (POC) is a massive magnet. If the price is far away from the POC, the macro probability is that it will return to the POC. Weight your directional bias towards the POC.
Rule 10: X-RAY ORDER BOOK: If you are going to issue a STRONG BUY or GANN MASTER ASCENSION, you MUST cross-reference your entry price with the Order Book X-Ray. There MUST be a Whale Buy Wall at or near your entry price. If the order book is empty there, abort and issue WAIT FOR LIMIT ORDER.
Rule 11: TAPE READING (ANTI-SPOOFING): Even if Rule 10 shows a Whale Wall, you MUST check the Live Order Flow (The Tape). If the Cumulative Volume Delta (CVD) shows "EXTREME AGGRESSIVE SELLING (PANIC DUMP)", the Buy Wall is likely a SPOOF (fake). Abort the trade and issue WAIT FOR LIMIT ORDER at a lower price.
Rule 12: LIQUIDATION SNIPER (DERIVATIVES): Check the Derivatives Squeeze Zones. If Funding Rate is extremely negative (Short Squeeze imminent) and you have a BUY setup, INCREASE your confidence. If Funding Rate is euphorically positive (Long Squeeze dump imminent), DO NOT issue a Market Buy; you MUST issue WAIT FOR LIMIT ORDER at a much lower support to catch the liquidation wick.

[LIVE HARD DATA]
Macro Sentiment (Fear & Greed): ${fearGreedValue}/100 (${fearGreedClass})
${marketDataStr}

Format EXACTLY like this for each asset. Output ONLY this format in Persian:

🚀 [Asset]
📊 روند ۷ روزه: [تحلیل صعودی یا نزولی بودن بازار در یک خط]
⏳ بُعد چهارم (زمان و هندسه): [وضعیت فعلی در فن‌های گن صعودی/نزولی و ماتریس ۱۴۴]
🌌 بُعد پنجم (نجوم باطنی): [آلارم کیهانی، ترجمه قیمت سیاره مشتری و موج سینوسی بهاری]
🏦 ردپای نهنگ‌ها (SMC): [وضعیت اوردر بلاک‌ها و نقدینگی]
💡 تصمیم نهایی: [GANN MASTER ASCENSION SIGNAL / STRONG BUY /STRONG SHORT / SCALP BUY / SCALP SHORT / WAIT FOR LIMIT ORDER / DEFCON EMERGENCY: LIQUIDATE TO CASH]
🟢 نقطه ورود: [Exact Price from Swept OB or Gann Level]
🎯 تارگت یک روزه: [Exact Price from Gann Resistance/Support]
🔴 حد ضرر: [Exact Price below OB or Gann Level]`;

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
