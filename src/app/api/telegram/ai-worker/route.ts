export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { sendTelegramMessage, sendTelegramAction } from '@/lib/telegram';
import { generateAIResponse } from '@/lib/ai';
import { verifyQStashSignature } from '@/lib/qstash';

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
    const { chatId: id, text } = await req.json();
    chatId = id;

    if (!chatId || !text) {
      return NextResponse.json({ error: "Missing chatId or text" }, { status: 400 });
    }

    // Send typing action to show user we're working
    await sendTelegramAction(chatId, 'typing');

    // 1. Fetch short-term memory from Redis
    const historyKey = `chat_history:${chatId}`;
    let rawHistory: any[] = [];
    try {
      rawHistory = await redis.lrange(historyKey, 0, -1);
    } catch (e) {
      console.error("Redis Fetch Error:", e);
    }

    const messages = rawHistory
      .filter(msg => msg && typeof msg.content === 'string' && msg.content.trim())
      .map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        content: msg.content as string,
      }));
    messages.push({ role: 'user', content: text });

    // 2. Fetch model preference
    let modelPref = 'pro';
    try {
      const pref = await redis.get(`model_pref:${chatId}`);
      if (pref === 'flash') modelPref = 'flash';
    } catch (e) {
      console.error("Redis Model Pref Error:", e);
    }
    const tryPro = modelPref === 'pro';

    // 3. Generate AI response (can take up to 60s — no Telegram timeout here!)
    let replyText = "متاسفانه خطایی در ارتباط با هوش مصنوعی رخ داد.";
    try {
      replyText = await generateAIResponse(messages, false, tryPro);

      // 4. Save to Redis
      try {
        await redis.rpush(historyKey, { role: "user", content: text });
        await redis.rpush(historyKey, { role: "model", content: replyText });
        await redis.ltrim(historyKey, -14, -1);
      } catch (e) {
        console.error("Redis Save Error:", e);
      }
    } catch (e) {
      console.error('AI Provider Error:', e);
    }

    // 5. Send reply to Telegram
    await sendTelegramMessage(chatId, replyText);

    return NextResponse.json({ ok: true });

  } catch (error: any) {
    console.error('[AI Worker Error]:', error);
    // Try to send an error message if we have chatId
    if (chatId) {
      try {
        await sendTelegramMessage(chatId, "⚠️ متاسفانه در پردازش درخواست شما خطایی رخ داد.");
      } catch (_) {}
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
