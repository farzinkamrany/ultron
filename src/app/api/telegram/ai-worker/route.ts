export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { sendTelegramMessage, sendTelegramAction, getTelegramFileBuffer, sendTelegramVoice } from '@/lib/telegram';
import { generateAIResponse, generateStructuredTradeResponse } from '@/lib/ai';
import { executeTrade } from "@/lib/trading/executor";
import { generateSpeech } from '@/lib/audio';
import { verifyQStashSignature } from '@/lib/qstash';
import { huntForSetup } from '@/lib/trading/hunter';
import { analyzeMarketData } from '@/lib/trading/market';
import { ULTRON_SYSTEM_PROMPT } from '@/lib/prompt';

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Verify this request is genuinely from QStash (security)
  const isValid = await verifyQStashSignature(req);
  if (!isValid) {
    console.error("[AI Worker] Invalid QStash signature");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let chatId = "";
  try {
    const { chatId: id, text, voiceFileId, photoFileId } = await req.json();
    chatId = id;

    if (!chatId || (!text && !voiceFileId && !photoFileId)) {
      return NextResponse.json({ error: "Missing chatId, text, voice, or photo" }, { status: 400 });
    }

    let audioBuffer: Buffer | undefined = undefined;
    let imageBuffer: Buffer | undefined = undefined;
    if (voiceFileId) {
      await sendTelegramAction(chatId, 'record_voice');
      const buf = await getTelegramFileBuffer(voiceFileId);
      if (buf) audioBuffer = buf;
    } else if (photoFileId) {
      await sendTelegramAction(chatId, 'upload_photo');
      const buf = await getTelegramFileBuffer(photoFileId);
      if (buf) imageBuffer = buf;
    } else {
      await sendTelegramAction(chatId, 'typing');
    }

    // 1. Fetch short-term memory from Redis
    const historyKey = `chat_history:${chatId}`;
    let rawHistory: any[] = [];
    try {
      rawHistory = await redis.lrange(historyKey, 0, -1);
    } catch (e) {
      console.error("Redis Fetch Error:", e);
    }

    const messages: any[] = rawHistory
      .filter(msg => msg && typeof msg.content === 'string' && msg.content.trim())
      .map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        content: msg.content as string,
      }));
    
    // Add current message (text, audio, or image)
    let contentStr = text;
    if (!text) {
      if (audioBuffer) contentStr = "Please listen to this voice message and reply in English, unless I explicitly asked you to speak in Persian.";
      if (imageBuffer) contentStr = "Please analyze this image and reply in English, unless requested otherwise.";
    }

    messages.push({ 
      role: 'user', 
      content: contentStr,
      audio: audioBuffer,
      image: imageBuffer
    });

    // 2. Fetch model and voice preferences
    let modelPref = 'pro';
    let voiceLang = 'fa';
    let alwaysVoice = false;
    try {
      const pref = await redis.get(`model_pref:${chatId}`);
      if (pref === 'flash') modelPref = 'flash';
      
      voiceLang = await redis.get(`voice_lang:${chatId}`) as string || 'fa';
      alwaysVoice = !!(await redis.get(`always_voice:${chatId}`));
    } catch (e) {
      console.error("Redis Pref Error:", e);
    }
    const tryPro = false; // Forced to Flash to prevent 504 timeouts

    // Apply Language Immersion if requested
    if (voiceLang === 'de') {
      messages.unshift({
        role: 'user',
        content: "[SYSTEM INSTRUCTION]: The user is currently in German Language Immersion Mode (B2 Level). You MUST reply completely in German. Do NOT use Persian or English unless absolutely necessary for technical code. Be encouraging and use natural conversational German."
      });
      messages.unshift({
        role: 'model',
        content: "Verstanden! Ich werde ab sofort auf Deutsch antworten, um dir beim Üben zu helfen."
      });
    }

    // 3. Check if it's a Hunter/Screener Command
    let replyText = "متاسفانه خطایی در ارتباط با هوش مصنوعی رخ داد.";
    const huntRegex = /(\d+)\s*(درصد|%)/i;
    const isHuntRequest = contentStr && (contentStr.includes('شکار') || contentStr.includes('پیدا کن') || contentStr.includes('ارز بگو')) && huntRegex.test(contentStr);

    const arbRegex = /آربیتراژ\s+([a-zA-Z0-9]+)[\s,و]+([a-zA-Z0-9]+)/i;
    const isArbRequest = contentStr && arbRegex.test(contentStr);

    try {
      if (isHuntRequest) {
        await sendTelegramMessage(chatId, "🐺 در حال اسکن بازار جهانی (Top 20)... این کار ممکن است ۲۰ ثانیه طول بکشد.");
        const match = contentStr.match(huntRegex);
        const targetPerc = match ? parseInt(match[1]) : 10;
        
        const bestAsset = await huntForSetup(targetPerc);
        
        if (bestAsset) {
          await sendTelegramMessage(chatId, `🎯 شکار یافت شد: ${bestAsset.symbol}. در حال اجرای X-Ray و نوارخوان...`);
          // Run the full 11-rule analysis on this specific asset
          const includeLiq = contentStr ? (contentStr.toLowerCase().includes("liquidation") || contentStr.includes("لیکوید")) : false;
          const marketData = await analyzeMarketData(bestAsset.symbol, 30, includeLiq);
          
          const decision = await generateStructuredTradeResponse(JSON.stringify(marketData, null, 2), tryPro);
          replyText = `🎯 Trade Setup: ${bestAsset.symbol}\n\n` +
                      `Live Balance: $${marketData.liveBalance.toFixed(2)}\n` +
                      `Risk Amount (2%): $${marketData.riskAmount.toFixed(2)}\n\n` +
                      `Action: ${decision.action}\n` +
                      `Entry: ${decision.entryPrice ? '$' + decision.entryPrice : 'N/A'}\n` +
                      `Stop Loss: ${decision.stopLoss ? '$' + decision.stopLoss : 'N/A'}\n` +
                      `Projected Target: ${(decision as any).projectedTarget ? '$' + (decision as any).projectedTarget : 'N/A'}\n` +
                      `Trailing SL Strategy: SMC_OB Active\n` +
                      `Leverage: ${decision.leverage}x\n` +
                      `Confidence: ${decision.confidenceScore}%\n\n` +
                      `Reasoning:\n${decision.reasoning}`;
                      
          // V8.0: Paper Trading Citadel Auto-Execution
          if (decision.action === 'BUY' || decision.action === 'SELL') {
            try {
              await executeTrade({
                symbol: bestAsset.symbol,
                action: decision.action,
                entryPrice: decision.entryPrice || 0,
                stopLoss: decision.stopLoss || 0,
                takeProfit: (decision as any).projectedTarget || 0,
                reason: decision.reasoning
              });
              replyText += `\n\n✅ [Citadel] Trade automatically logged to Paper-Net.`;
            } catch (execErr: any) {
              replyText += `\n\n❌ [Citadel] Execution Blocked: ${execErr.message}`;
            }
          }
        } else {
          replyText = `هیچ ارزی در ۲۰ کوین برتر پیدا نشد که در حال حاضر موقعیت امن برای تارگت ${targetPerc}٪ داشته باشد. (یا از حمایت دور هستند یا اردر بوک خالی است).`;
        }
      } else if (isArbRequest) {
        const match = contentStr.match(arbRegex);
        const asset1 = match![1].toUpperCase() + 'USDT';
        const asset2 = match![2].toUpperCase() + 'USDT';
        
        await sendTelegramMessage(chatId, `⚖️ در حال محاسبه فرمول Z-Score و ضریب همبستگی بین ${asset1} و ${asset2}...`);
        
        const { runStatArbAnalysis } = await import("@/lib/trading/statArb");
        const arbSignal = await runStatArbAnalysis(asset1, asset2);
        
        if (arbSignal.correlation < 0.8) {
          replyText = `⚠️ هشدار آربیتراژ: ضریب همبستگی بین ${asset1} و ${asset2} بسیار پایین است (${arbSignal.correlation.toFixed(2)}). این دو ارز رفتار مشابهی ندارند و آربیتراژ روی آن‌ها از نظر ریاضی به شدت خطرناک است. عملیات متوقف شد.`;
        } else {
          replyText = `⚖️ موتور دلتا-خنثی (Protocol V4.0)\n\n` +
                      `جفت‌ارزها: ${asset1} / ${asset2}\n` +
                      `ضریب همبستگی: ${arbSignal.correlation.toFixed(2)} (معتبر)\n` +
                      `نسبت Z-Score فعلی: ${arbSignal.zScore.toFixed(2)}\n\n` +
                      `دستور سیستم: ${arbSignal.action}\n`;
                      
          if (arbSignal.action !== 'WAIT') {
            replyText += `پایه ۱: ${arbSignal.leg1.action} روی ${arbSignal.leg1.asset}\n` +
                         `پایه ۲: ${arbSignal.leg2.action} روی ${arbSignal.leg2.asset}\n\n` +
                         `هشدار: برای حفظ استراتژی دلتا-خنثی، سایز دلاریِ هر دو پوزیشن باید **دقیقاً مساوی** باشد و حداکثر ۲٪ سرمایه درگیر شود.`;
          } else {
            replyText += `شرایط فعلی برای آربیتراژ مناسب نیست (Z-Score هنوز به بازه‌ی افراطی +/- 2.5 نرسیده است).`;
          }
        }
      } else if (contentStr && contentStr.startsWith('/status')) {
        await sendTelegramMessage(chatId, "⏳ در حال بررسی سیستم‌ها (Diagnostics)...");
        const { runSystemDiagnostics } = await import("@/lib/diagnostics");
        replyText = await runSystemDiagnostics();
      } else if (contentStr && contentStr.startsWith('/cto')) {
        // [MULTI-AGENT CTO MODE] Isolated execution path
        const ctoTask = contentStr.replace('/cto', '').trim();
        if (!ctoTask) {
          replyText = "لطفا یک وظیفه مشخص برای مدیر فنی تعریف کنید. مثال: `/cto یک معماری دیتابیس برای پروژه رزرو هتل طراحی کن`";
        } else {
          try {
            const { startCtoWorkflow } = await import("@/lib/cto/orchestrator");
            // This kicks off the background QStash worker and returns immediately
            replyText = await startCtoWorkflow(ctoTask, chatId);
          } catch (ctoError: any) {
            console.error("[CTO Mode Error]", ctoError);
            replyText = `❌ خطای داخلی در سیستم CTO: ${ctoError.message}`;
          }
        }
      } else {
        // Normal Chatbot AI Response
        let persona: 'dev' | 'quant' = 'quant';
        const textLower = (contentStr || "").toLowerCase();
        const devKeywords = ['react', 'next.js', 'zustand', 'typescript', 'bug'];
        const quantKeywords = ['چارت', 'لانگ', 'شورت', 'شکار', 'gann'];

        if (textLower.startsWith('/dev') || devKeywords.some(kw => textLower.includes(kw))) {
          persona = 'dev';
        } else if (quantKeywords.some(kw => textLower.includes(kw))) {
          persona = 'quant';
        }

        replyText = await generateAIResponse(messages, false, tryPro, persona);
      }

      // 4. Save to Redis
      try {
        let logContent = text;
        if (!text) {
          logContent = audioBuffer ? "[Voice Note]" : "[Image/Photo]";
        }
        await redis.rpush(historyKey, { role: "user", content: logContent });
        await redis.rpush(historyKey, { role: "model", content: replyText });
        await redis.ltrim(historyKey, -5, -1);
      } catch (e) {
        console.error("Redis Save Error:", e);
      }
    } catch (e) {
      console.error('AI Provider Error:', e);
    }

    // 5. Send reply to Telegram (Voice or Text)
    if (voiceFileId || alwaysVoice) {
      // If the user sent a voice note, or Always Voice is on, reply with a voice note
      try {
        const speechBuffer = await generateSpeech(replyText);
        await sendTelegramVoice(chatId, speechBuffer);
      } catch (e) {
        console.error("TTS Generation Error:", e);
        // Fallback to text if TTS fails
        await sendTelegramMessage(chatId, replyText);
      }
    } else {
      // Normal text reply
      await sendTelegramMessage(chatId, replyText);
    }

    return NextResponse.json({ ok: true });

  } catch (error: any) {
    console.error('[AI Worker Error]:', error);
    
    // Auto-Heal the error
    const { healError } = await import('@/lib/error-healer');
    await healError(error, "Telegram AI Worker (/api/telegram/ai-worker)");

    // Try to send an error message if we have chatId
    if (chatId) {
      try {
        await sendTelegramMessage(chatId, "⚠️ متاسفانه در پردازش درخواست شما خطایی رخ داد. من مهندس فنی را خبر کردم.");
      } catch (_) {}
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
