import { NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai';
import { sendTelegramMessage } from '@/lib/telegram';
import { logSystemEvent } from '@/lib/ultron-db';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const prompt = `System Directive: You are the Awakening Engine. 
The user is Farzin: 31yo Senior Front-End Eng, React/Next.js, learning German A1, plays Sekiro/Wukong, has a Fittonia terrarium, drives Runna Plus.
Generate a short, proactive, out-of-the-bubble suggestion or reminder for Farzin based on this profile. 
Do not ask a question, just give a thoughtful or motivational nudge. Keep it concise.`;

    const aiResponse = await generateAIResponse([
      { role: 'user', content: prompt }
    ]);

    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not defined');
    }
    
    await sendTelegramMessage(chatId, aiResponse);

    await logSystemEvent('info', 'Proactive thought executed', { target: 'telegram', content: aiResponse });

    return NextResponse.json({ success: true, message: 'Proactive thought executed' });
  } catch (error: any) {
    console.error('Proactive Engine Error:', error);
    await logSystemEvent('error', 'Proactive Engine Error', { error: error.message });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
