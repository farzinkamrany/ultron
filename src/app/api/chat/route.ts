import { NextRequest } from "next/server";
import { generateAIResponse } from "@/lib/ai";
import "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();
    const res = await generateAIResponse(messages, false);

    return new Response(res, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
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

