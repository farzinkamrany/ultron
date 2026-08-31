export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { sendTelegramMessage, sendTelegramAction, getTelegramFileBuffer, sendTelegramVoice } from '@/lib/telegram';
import { generateAIResponse } from '@/lib/ai';
import { generateFarsiSpeech } from '@/lib/audio';
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
      if (audioBuffer) contentStr = "Please listen to this voice message and reply in Persian.";
      if (imageBuffer) contentStr = "Please analyze this image and reply in Persian.";
    }

    messages.push({ 
      role: 'user', 
      content: contentStr,
      audio: audioBuffer,
      image: imageBuffer
    });

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
        let logContent = text;
        if (!text) {
          logContent = audioBuffer ? "[Voice Note]" : "[Image/Photo]";
        }
        await redis.rpush(historyKey, { role: "user", content: logContent });
        await redis.rpush(historyKey, { role: "model", content: replyText });
        await redis.ltrim(historyKey, -14, -1);
      } catch (e) {
        console.error("Redis Save Error:", e);
      }
    } catch (e) {
      console.error('AI Provider Error:', e);
    }

    // 5. Send reply to Telegram (Voice or Text)
    if (voiceFileId) {
      // If the user sent a voice note, reply with a voice note
      try {
        const speechBuffer = await generateFarsiSpeech(replyText);
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
    // Try to send an error message if we have chatId
    if (chatId) {
      try {
        await sendTelegramMessage(chatId, "⚠️ متاسفانه در پردازش درخواست شما خطایی رخ داد.");
      } catch (_) {}
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
