export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage, sendTelegramAction } from '@/lib/telegram';
import { redis } from '@/lib/redis';
import { logExpense } from '@/lib/ultron-tracker';

export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const message = body?.message;
    if (!message || (!message.text && !message.voice && !message.photo)) {
      return new NextResponse('OK', { status: 200 });
    }

    const chatId = message.chat.id.toString();
    const text = message.text || message.caption || "";
    const voiceFileId = message.voice?.file_id;
    const photoFileId = message.photo && message.photo.length > 0 ? message.photo[message.photo.length - 1].file_id : undefined;
    const allowedChatIdsStr = process.env.TELEGRAM_ALLOWED_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "";
    const allowedChatIds = allowedChatIdsStr.split(',').map((id: string) => id.trim());

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    // Security Check
    if (!allowedChatIds.includes(chatId)) {
      console.warn(`Unauthorized access attempt from chat ID: ${chatId}`);
      return new NextResponse('OK', { status: 200 });
    }

    if (!botToken || !geminiKey) {
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
      if (voiceChoice === 'de' || voiceChoice === 'fa') {
        try {
          await redis.set(`voice_lang:${chatId}`, voiceChoice);
          const langName = voiceChoice === 'de' ? 'German (B2 Partner)' : 'Persian (Default)';
          await sendTelegramMessage(chatId, `🗣️ Voice Mode switched to: ${langName}`);
        } catch (e) {
          console.error("Failed to save voice preference:", e);
        }
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

    if (text.startsWith('/dashboard')) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ultron-assistant-iota.vercel.app";
      await sendTelegramMessage(chatId, "📊 Open Ultron Dashboard:", {
        inline_keyboard: [
          [{ text: "📊 Open Dashboard", web_app: { url: `${appUrl}/dashboard/trading` } }]
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
      await fetch(`https://qstash.upstash.io/v2/publish/${appUrl}/api/telegram/ai-worker`, {
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
    } // Return 200 immediately — Telegram is satisfied, QStash handles the rest
    return new NextResponse('OK', { status: 200 });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    return new NextResponse('OK', { status: 200 });
  }
}
