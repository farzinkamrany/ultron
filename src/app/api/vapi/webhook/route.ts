import { NextRequest, NextResponse } from "next/server";
import { generateAIResponse } from "@/lib/ai";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Phase 13: Webhook Security for Vapi
    const vapiSecret = req.headers.get('x-vapi-secret');
    if (process.env.VAPI_WEBHOOK_SECRET && vapiSecret !== process.env.VAPI_WEBHOOK_SECRET) {
      console.warn("Unauthorized Vapi webhook attempt");
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const body = await req.json();

    // Vapi sends different types of webhook events
    const { message } = body;

    if (message.type === "conversation-update") {
      // Handled internally by Vapi, we might not need to respond with AI here
      return NextResponse.json({ ok: true });
    }

    if (message.type === "function-call") {
      // Setup function calling so Ultron can trigger backend actions
      const { functionCall } = message;
      console.log("[VAPI Function Call]:", functionCall);
      
      // We can implement actual function logic here later
      return NextResponse.json({
        result: `Function ${functionCall.name} executed successfully.`
      });
    }

    // If Vapi is using this as a Custom LLM URL, it sends messages array
    if (body.messages) {
      // Map OpenAI format to our format
      const messages = body.messages.map((m: any) => ({
        role: m.role,
        content: m.content
      }));

      // Fetch voice_lang preference from Redis (using Admin Chat ID as default for personal assistant)
      let voiceLang = "fa";
      const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (adminChatId) {
        try {
          const pref = await redis.get(`voice_lang:${adminChatId}`);
          if (pref === "de") voiceLang = "de";
        } catch (e) {
          console.error("Redis fetch voice_lang error:", e);
        }
      }

      // Inject system directive based on preference
      if (voiceLang === "de") {
        messages.unshift({
          role: "user",
          content: "[SYSTEM DIRECTIVE FOR VAPI VOICE]: Du bist Ultron, ein B2-Deutschlernpartner. Sprich NUR auf Deutsch. Halte Sätze kurz (max. 2 Sätze). Stelle Rückfragen, um das Gespräch aktiv zu halten. Nutze Alltagsvokabular zu den Themen Pendeln, Sport und Technologie. Wechsle niemals ins Englische oder Persische. DO NOT use any markdown formatting."
        });
      } else {
        messages.unshift({
          role: "user",
          content: "[SYSTEM DIRECTIVE FOR VAPI VOICE]: You are interacting via voice in Persian (Farsi). Keep your responses short, conversational, and highly engaging. DO NOT use any markdown formatting (no asterisks, bolding, italics, or code blocks)."
        });
      }

      // Generate non-streaming response for simplicity in webhook,
      // though Vapi supports streaming. Let's return JSON for now.
      const aiText = await generateAIResponse(messages, false);

      return NextResponse.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: aiText
            }
          }
        ]
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Vapi Webhook Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
