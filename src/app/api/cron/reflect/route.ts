import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { generateAIResponse } from '@/lib/ai';
import { storeMemory } from '@/lib/memory';
import { verifyQStashSignature } from '@/lib/qstash';

export const dynamic = "force-dynamic";
export const maxDuration = 60; 

export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (!isDev) {
    const authHeader = request.headers.get('authorization');
    const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    const isQStash = !!request.headers.get('upstash-signature');
    
    if (isQStash) {
      const isValid = await verifyQStashSignature(request);
      if (!isValid) return new NextResponse('Unauthorized QStash', { status: 401 });
    } else if (!isVercelCron) {
      return new NextResponse('Unauthorized Cron Secret', { status: 401 });
    }
  }

  try {
    // Find all chat history keys
    const keys = await redis.keys('chat_history:*');
    
    if (keys.length === 0) {
      return NextResponse.json({ success: true, message: "No active chats found." });
    }

    let memoriesCreated = 0;

    for (const key of keys) {
      const chatId = key.replace('chat_history:', '');
      const rawHistory = await redis.lrange(key, 0, -1);
      
      if (!rawHistory || rawHistory.length < 4) continue; // Only process if there's substantial conversation

      // Format history for the AI
      const conversationText = rawHistory
        .map((msg: any) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join('\n');

      const systemPrompt = `You are an internal reflection engine. 
Analyze the following conversation log between a User and an AI Assistant.
Your job is to extract LONG-TERM MEMORIES. This includes:
1. Facts about the user (preferences, job, location, goals)
2. New permanent rules or instructions the user gave to the AI
3. Important decisions made or trades executed
4. Context that might be relevant weeks or months from now.

If there is nothing of long-term importance, reply exactly with the word: EMPTY.
Otherwise, reply with a concise summary paragraph (written in the 3rd person about the user, e.g., "The user works at Bimeh.com", or "Rule added: Never talk about Berlin").`;

      const aiResponse = await generateAIResponse([
        { role: 'user', content: systemPrompt },
        { role: 'model', content: "Understood. Please provide the conversation log." },
        { role: 'user', content: conversationText }
      ], false, false); // use flash model for cheaper/faster reflection

      if (aiResponse.trim() !== "EMPTY" && !aiResponse.includes("EMPTY")) {
        console.log(`[Reflection] Storing new memory for chat ${chatId}: ${aiResponse}`);
        await storeMemory(aiResponse, { chatId, date: new Date().toISOString() });
        memoriesCreated++;
      }
    }

    return NextResponse.json({ success: true, memoriesCreated });
  } catch (error: any) {
    console.error('Reflection Cron Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
