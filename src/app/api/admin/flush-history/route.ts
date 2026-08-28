import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

// One-time admin endpoint to flush stale Redis chat history
// Hit: GET http://localhost:3000/api/admin/flush-history
// DELETE this file after running it once.
export async function GET() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    return NextResponse.json({ error: "TELEGRAM_CHAT_ID not set" }, { status: 400 });
  }

  const key = `chat_history:${chatId}`;
  try {
    await redis.del(key);
    return NextResponse.json({ success: true, cleared_key: key });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
