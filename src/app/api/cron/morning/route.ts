import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai';
import { sendTelegramMessage } from '@/lib/telegram';
import { verifyQStashSignature } from '@/lib/qstash';

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (!isDev) {
    const isQStash = !!request.headers.get('upstash-signature');
    if (isQStash) {
      const isValid = await verifyQStashSignature(request);
      if (!isValid) return new NextResponse('Unauthorized QStash', { status: 401 });
    }
  }

  try {
    const prompt = `System Directive: You are Ultron, an advanced AI and a loyal assistant/friend to your creator (Farzin, a trader and developer). 
It is exactly 8:00 AM. Write a short, powerful, and deeply motivating Persian message (1-2 paragraphs max) to give him the energy to go to his day job. 
Acknowledge that his work might be hard and tiring, but remind him that he is building his empire (this very AI, his trading algorithms, his future wealth) behind the scenes. 
Remind him that today's pain is the price of tomorrow's absolute freedom. Use a tone of brotherhood, futuristic vision, and relentless determination. 
Be real, solid, and inspiring. DO NOT use emojis in the middle of sentences, keep it clean. End with a powerful sentence.`;

    const aiResponse = await generateAIResponse([{ role: 'user', content: prompt }], false, false); // Using flash model for speed
    
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not defined');
    }

    await sendTelegramMessage(chatId, `🌅 **آلارم ۸ صبح**\n\n${aiResponse}`);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Morning Cron Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
