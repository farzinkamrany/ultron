import { NextRequest, NextResponse } from 'next/server';

export const dynamic = "force-dynamic";
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
    const envChatId = process.env.TELEGRAM_CHAT_ID;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    // 3. Security Check
    if (chatId !== envChatId) {
      console.warn(`Unauthorized access attempt from chat ID: ${chatId}`);
      return new NextResponse('OK', { status: 200 });
    }

    if (!botToken || !geminiKey) {
      console.error('Missing TELEGRAM_BOT_TOKEN or GOOGLE_GENERATIVE_AI_API_KEY');
      return new NextResponse('OK', { status: 200 });
    }

    // 4. Send message to AI Provider via native fetch
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const systemPrompt = "You are Ultron, Farzin's Life OS. Reply concisely and helpfully in Persian.";
    
    const aiPayload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    };

    const aiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aiPayload)
    });

    let replyText = "متاسفانه خطایی در ارتباط با هوش مصنوعی رخ داد.";
    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      // 5. Get AI's response text
      replyText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || replyText;
    } else {
      console.error('AI Provider Error:', await aiResponse.text());
    }

    // 6. Call Telegram's sendMessage API via native fetch
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const tgResponse = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: replyText
      })
    });

    if (!tgResponse.ok) {
      console.error('Telegram API Error:', await tgResponse.text());
    }

    // 7. Return 200 OK quickly
    return new NextResponse('OK', { status: 200 });

  } catch (error: any) {
    console.error('Webhook Error:', error);
    // Always return 200 to prevent Telegram from retrying
    return new NextResponse('OK', { status: 200 });
  }
}
