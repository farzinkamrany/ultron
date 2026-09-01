import { NextRequest } from "next/server";
import { generateAIResponse } from "@/lib/ai";
import { executeCtoWorkflow } from "@/lib/cto/orchestrator";
import "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    if (!messages || messages.length === 0) throw new Error("No messages provided");

    const lastMessage = messages[messages.length - 1].content;
    const isCto = lastMessage.trim().startsWith("/cto");

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (isCto) {
            const ctoTask = lastMessage.replace('/cto', '').trim();
            if (!ctoTask) {
              controller.enqueue(encoder.encode("لطفا یک وظیفه مشخص برای مدیر فنی تعریف کنید. مثال: `/cto یک معماری دیتابیس طراحی کن`"));
            } else {
              const finalSummary = await executeCtoWorkflow(ctoTask, async (msg: string) => {
                // Stream real-time updates to the Web UI
                controller.enqueue(encoder.encode(`> ${msg}\n\n`));
              });
              controller.enqueue(encoder.encode(`\n\n---\n\n${finalSummary}`));
            }
          } else {
            // Normal Chatbot AI Response
            const res = await generateAIResponse(messages, false);
            controller.enqueue(encoder.encode(res));
          }
        } catch (err: any) {
          console.error("[Chat Stream Error]:", err);
          controller.enqueue(encoder.encode(`\n\n❌ Error: ${err.message}`));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });

  } catch (error: any) {
    console.error("[ULTRON API Error]:", error.message);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

