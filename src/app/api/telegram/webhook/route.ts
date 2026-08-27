import { NextRequest, NextResponse } from "next/server";
import { generateAIResponse } from "@/lib/ai";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.message || !body.message.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = body.message.chat.id;
    const text = body.message.text;

    const messages = [{ role: "user", content: text }];
    const aiText = await generateAIResponse(messages, false);

    await sendTelegramMessage(chatId, aiText);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Telegram Webhook Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
