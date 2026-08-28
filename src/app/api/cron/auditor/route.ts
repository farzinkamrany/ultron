import { NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';
// import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  // Validate CRON_SECRET in production
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new NextResponse('Unauthorized', { status: 401 });
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
