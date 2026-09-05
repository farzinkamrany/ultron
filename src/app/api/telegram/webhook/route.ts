export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage, sendTelegramAction } from '@/lib/telegram';
import { redis } from '@/lib/redis';
import { logExpense } from '@/lib/ultron-tracker';
import { triggerPanicClose } from '@/lib/trading/executor';

export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let chatId = "";
    let text = "";
    let voiceFileId;
    let photoFileId;

    if (body?.callback_query) {
      chatId = body.callback_query.message.chat.id.toString();
      text = body.callback_query.data; // The callback data (e.g., 'panic_close')
    } else if (body?.message) {
      const message = body.message;
      if (!message.text && !message.voice && !message.photo) return new NextResponse('OK', { status: 200 });
      chatId = message.chat.id.toString();
      text = message.text || message.caption || "";
      voiceFileId = message.voice?.file_id;
      photoFileId = message.photo && message.photo.length > 0 ? message.photo[message.photo.length - 1].file_id : undefined;
    } else {
      return new NextResponse('OK', { status: 200 });
    }

    const allowedChatIdsStr = process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "";
    const allowedChatIds = allowedChatIdsStr.split(',').map((id: string) => id.trim());

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    // Security Check
    if (!allowedChatIds.includes(chatId)) {
      console.warn(`Unauthorized access attempt from chat ID: ${chatId}`);
      return new NextResponse('OK', { status: 200 });
    }

    if (!botToken) {
      return new NextResponse('OK', { status: 200 });
    }

    // ─── Instant Commands (no AI needed, reply immediately) ───────────────────

    if (text.startsWith('/model ')) {
      const modelChoice = text.replace('/model ', '').trim().toLowerCase();
      if (modelChoice === 'pro' || modelChoice === 'flash') {
        try {
          await redis.set(`model_pref:${chatId}`, modelChoice);
          await sendTelegramMessage(chatId, `✅ AI Core switched to: ${modelChoice.toUpperCase()}`);
        } catch (e) {
          console.error("Failed to save model preference:", e);
        }
      }
      return new NextResponse('OK', { status: 200 });
    }

    if (text.startsWith('/voice ')) {
      const voiceChoice = text.replace('/voice ', '').trim().toLowerCase();
      
      try {
        if (voiceChoice === 'de' || voiceChoice === 'fa') {
          await redis.set(`voice_lang:${chatId}`, voiceChoice);
          const langName = voiceChoice === 'de' ? 'German (B2 Partner)' : 'Persian (Default)';
          await sendTelegramMessage(chatId, `🗣️ Language Immersion switched to: ${langName}`);
        } else if (voiceChoice === 'always') {
          await redis.set(`always_voice:${chatId}`, 'true');
          await sendTelegramMessage(chatId, `🎙️ Always-Voice Mode ACTIVATED. I will always reply with audio.`);
        } else if (voiceChoice === 'off' || voiceChoice === 'text') {
          await redis.del(`always_voice:${chatId}`);
          await redis.del(`voice_lang:${chatId}`);
          await sendTelegramMessage(chatId, `📝 Always-Voice and Immersion DEACTIVATED. Reverting to standard text/Persian mode.`);
        } else {
          await sendTelegramMessage(chatId, `❌ Unknown voice command. Try: /voice de | /voice fa | /voice always | /voice off`);
        }
      } catch (e) {
        console.error("Failed to save voice preference:", e);
      }
      return new NextResponse('OK', { status: 200 });
    }

    if (text.startsWith('/spend ')) {
      const amountRegex = /(\d+k|\d+)\s+(.+)/i;
      const match = text.replace('/spend ', '').match(amountRegex);
      if (match) {
        let amountStr = match[1].toLowerCase();
        let amount = parseInt(amountStr);
        if (amountStr.endsWith('k')) amount = amount * 1000;
        const category = match[2].trim();
        try {
          await logExpense(amount, category);
          await sendTelegramMessage(chatId, `✅ Expense logged: ${amount.toLocaleString()} for ${category}`);
        } catch (e) {
          console.error("Failed to log expense:", e);
        }
      }
      return new NextResponse('OK', { status: 200 });
    }

    if (text === 'panic_close' || text.startsWith('/panic')) {
      try {
        await triggerPanicClose();
        // Answer callback query if needed (usually a separate endpoint, but we can just send a message)
      } catch (e) {
        console.error("Panic close failed:", e);
      }
      return new NextResponse('OK', { status: 200 });
    }

    if (text.startsWith('/dashboard')) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ultron-assistant-iota.vercel.app";
      await sendTelegramMessage(chatId, "📊 **Ultron Control Center**\n\nSelect an option below:", {
        inline_keyboard: [
          [{ text: "📊 Open Life OS Dashboard", web_app: { url: `${appUrl}/` } }],
          [{ text: "🚨 PANIC CLOSE ALL TRADES 🚨", callback_data: "panic_close" }]
        ]
      });
      return new NextResponse('OK', { status: 200 });
    }

    // ─── AI Messages: Offload to QStash worker ────────────────────────────────
    let action = 'typing';
    if (voiceFileId) action = 'record_voice';
    else if (photoFileId) action = 'upload_photo';
    await sendTelegramAction(chatId, action);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ultron-assistant-iota.vercel.app";
    const qstashToken = process.env.QSTASH_TOKEN;

    if (!qstashToken) {
      console.warn("QSTASH_TOKEN not found. Bypassing QStash (local dev mode?).");
      // Fallback: you could call the worker directly but it might timeout.
    } else {
      // Publish to QStash — this returns immediately while QStash calls the worker async
      const qstashRes = await fetch(`https://qstash.upstash.io/v2/publish/${appUrl}/api/telegram/ai-worker`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${qstashToken}`,
          "Content-Type": "application/json",
          "Upstash-Method": "POST",
          "Upstash-Retries": "0" // Only try once for chat messages
        },
        body: JSON.stringify({
          chatId,
          text,
          voiceFileId,
          photoFileId
        })
      });
      
      if (!qstashRes.ok) {
        const errorText = await qstashRes.text();
        console.error("❌ QStash Publish Failed:", qstashRes.status, errorText);
        await sendTelegramMessage(chatId, `⚠️ **خطای سیستم QStash:** سرور Upstash پیام شما را قبول نکرد (کد ${qstashRes.status}). لطفاً لاگ‌های Vercel را برای /api/telegram/webhook چک کنید.`);
      } else {
        console.log("✅ QStash Publish Success for chat:", chatId);
      }
    } // Return 200 immediately — Telegram is satisfied, QStash handles the rest
    return new NextResponse('OK', { status: 200 });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return new NextResponse('OK', { status: 200 });
  }
}
