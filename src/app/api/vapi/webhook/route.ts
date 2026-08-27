import { NextRequest, NextResponse } from "next/server";
import { generateAIResponse } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
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
