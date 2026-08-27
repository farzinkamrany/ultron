import { NextRequest } from "next/server";
import { generateAIResponse } from "@/lib/ai";
import "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const res = await generateAIResponse(messages, true);

    const stream = new ReadableStream({
      start(controller) {
        res.on("data", (chunk: any) => {
          const textChunk = chunk.toString();
          const lines = textChunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const dataStr = line.replace("data: ", "");
                const dataJson = JSON.parse(dataStr);
                const text = dataJson?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  controller.enqueue(new TextEncoder().encode(text));
                }
              } catch (e) {}
            }
          }
        });

        res.on("end", () => controller.close());
        res.on("error", (err: any) => controller.error(err));
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked"
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

