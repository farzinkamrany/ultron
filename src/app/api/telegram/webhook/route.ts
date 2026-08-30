export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { logExpense } from '@/lib/ultron-tracker';
import { sendTelegramMessage, sendTelegramAction } from '@/lib/telegram';
import { generateAIResponse } from '@/lib/ai';

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // 1. Parse incoming JSON payload
    const body = await req.json();

    // 2. Extract message.text and message.chat.id
    const message = body?.message;
    if (!message || !message.text) {
      return new NextResponse('OK', { status: 200 });
    }

    const chatId = message.chat.id.toString();
    const text = message.text;
    const allowedChatIdsStr = process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "";
    const allowedChatIds = allowedChatIdsStr.split(',').map(id => id.trim());
    
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    // 3. Security Check
    if (!allowedChatIds.includes(chatId)) {
      console.warn(`Unauthorized access attempt from chat ID: ${chatId}`);
      return new NextResponse('OK', { status: 200 });
    }

    if (!botToken || !geminiKey) {
      console.error('Missing TELEGRAM_BOT_TOKEN or GOOGLE_GENERATIVE_AI_API_KEY');
      return new NextResponse('OK', { status: 200 });
    }

    // 3.5. Command Parsing
    if (text.startsWith('/model ')) {
      const modelChoice = text.replace('/model ', '').trim().toLowerCase();
      if (modelChoice === 'pro' || modelChoice === 'flash') {
        try {
          await redis.set(`model_pref:${chatId}`, modelChoice);
          await sendTelegramMessage(chatId, `✅ AI Core switched to: ${modelChoice.toUpperCase()}`);
        } catch (e) {
          console.error("Failed to save model preference:", e);
        }
        return new NextResponse('OK', { status: 200 });
      }
    }

    if (text.startsWith('/spend ')) {
      const amountRegex = /(\d+k|\d+)\s+(.+)/i;
      const match = text.replace('/spend ', '').match(amountRegex);

      if (match) {
        let amountStr = match[1].toLowerCase();
        let amount = parseInt(amountStr);
        if (amountStr.endsWith('k')) {
          amount = amount * 1000;
        }

        const category = match[2].trim();

        try {
          await logExpense(amount, category);
          const replyText = `✅ Expense logged: ${amount.toLocaleString()} for ${category}`;

          await sendTelegramMessage(chatId, replyText);
        } catch (e) {
          console.error("Failed to log expense:", e);
        }

        return new NextResponse('OK', { status: 200 });
      }
    }

    if (text.startsWith('/dashboard')) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ultron-assistant-iota.vercel.app";
      await sendTelegramMessage(chatId, "📊 Open Ultron Dashboard:", {
        inline_keyboard: [
          [{ text: "📊 Open Dashboard", web_app: { url: `${appUrl}/dashboard/trading` } }]
        ]
      });
      return new NextResponse('OK', { status: 200 });
    }

    // 4. Fetch Short-Term Memory from Redis
    const historyKey = `chat_history:${chatId}`;
    let rawHistory: any[] = [];
    try {
      rawHistory = await redis.lrange(historyKey, 0, -1);
    } catch (e) {
      console.error("Redis Fetch Error:", e);
    }

    // Sanitize history: only keep entries with valid string content (guards against
    // dangling functionCall turns that were never resolved, which cause instant loops)
    const messages = rawHistory
      .filter(msg => msg && typeof msg.content === 'string' && msg.content.trim())
      .map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        content: msg.content as string,
      }));
    messages.push({ role: 'user', content: text });

    // 5. Fetch Model Preference
    let modelPref = 'pro'; // default
    try {
      const pref = await redis.get(`model_pref:${chatId}`);
      if (pref === 'flash') modelPref = 'flash';
    } catch (e) {
      console.error("Redis Model Pref Fetch Error:", e);
    }
    const tryPro = modelPref === 'pro';

    // 6. Generate AI Response (Using proxy-aware helper)
    // Send typing action to Telegram so user knows bot is processing
    await sendTelegramAction(chatId, 'typing');
    
    let replyText = "متاسفانه خطایی در ارتباط با هوش مصنوعی رخ داد.";
    try {
      replyText = await generateAIResponse(messages, false, tryPro);

      // Save new interaction to Redis
      try {
        await redis.rpush(historyKey, { role: "user", content: text });
        await redis.rpush(historyKey, { role: "model", content: replyText });
        // Keep only last 14 messages (7 interactions)
        await redis.ltrim(historyKey, -14, -1);
      } catch (e) {
        console.error("Redis Save Error:", e);
      }
    } catch (e) {
      console.error('AI Provider Error:', e);
    }

    // 6. Send message back to Telegram (Using proxy-aware helper)
    try {
      await sendTelegramMessage(chatId, replyText);
    } catch (e) {
      console.error('Telegram API Error:', e);
    }

    // 7. Return 200 OK quickly
    return new NextResponse('OK', { status: 200 });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    // Always return 200 to prevent Telegram from retrying
    return new NextResponse('OK', { status: 200 });
  }
}
