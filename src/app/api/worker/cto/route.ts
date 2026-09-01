export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyQStashSignature } from "@/lib/qstash";
import { processCtoStep } from "@/lib/cto/orchestrator";

// Allow max duration of 60 seconds (Vercel Hobby limit). Since each QStash
// step only executes a single LLM call, this is safely within limits!
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 1. Verify this request genuinely came from Upstash QStash
  const isQStash = !!req.headers.get("upstash-signature");
  if (isQStash) {
    const isValid = await verifyQStashSignature(req);
    if (!isValid) {
      console.error("[QStash Worker] Invalid QStash signature");
      return new NextResponse("Unauthorized QStash Signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Block direct API calls in production that aren't from QStash
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();
    const { taskId } = body;

    if (!taskId) {
      return new NextResponse("Missing taskId", { status: 400 });
    }

    console.log(`[QStash Worker] Executing step for CTO Task: ${taskId}`);
    
    // 2. Process exactly ONE step of the workflow.
    // If successful, processCtoStep will internally publish the next QStash event.
    await processCtoStep(taskId);

    return NextResponse.json({ ok: true, taskId });

  } catch (error: any) {
    console.error("[QStash Worker] Error processing task:", error);
    // Returning 500 will cause QStash to retry automatically with exponential backoff!
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
