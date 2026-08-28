export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';
// import { supabase } from '@/lib/supabase';
import { verifyQStashSignature } from '@/lib/qstash';

export async function POST(request: Request) {
  const isValid = await verifyQStashSignature(request);
  if (!isValid) {
    return new NextResponse('Unauthorized: Invalid QStash Signature', { status: 401 });
  }

  try {
    // Phase 12: Schedule Auditor Logic
    // In a full implementation, you would query the latest location from Supabase
    // const { data } = await supabase.from('locations').order('created_at', { ascending: false }).limit(1).single();
    // const isOverworking = data?.poi === 'OFFICE';

    // Simulating the check for now
    const isOverworking = true;

    if (isOverworking) {
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (chatId) {
        const alertMsg = "⚠️ *Schedule Alert:* Farzin, you are still at the OFFICE past your 18:00 shift. You are overworking. Go home, hit the gym, or study German.";
        await sendTelegramMessage(chatId, alertMsg);
      }
    }

    return NextResponse.json({ success: true, checked: true });
  } catch (error: any) {
    console.error('Auditor Cron Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
