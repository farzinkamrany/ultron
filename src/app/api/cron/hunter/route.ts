import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';
import { huntForSetup } from '@/lib/trading/hunter';
import { verifyQStashSignature } from '@/lib/qstash';

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow enough time for ccxt scanning

export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  
  // Authenticate using Vercel CRON_SECRET or Upstash QStash
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
    // Hunt for a setup with at least 3% profit potential
    const bestAsset = await huntForSetup(3.0);
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not defined');
    }

    if (bestAsset) {
      const message = `🎯 **آلارم شکارچی بازار (Hunter)** 🎯\n\nارز **${bestAsset}** در یک نقطه حمایتی هندسیِ فوق‌العاده قرار دارد و پتانسیل سودِ حداقل ۳ درصدی تا مقاومتِ بعدی را دارد.\n\nپیشنهاد می‌کنم چارت این ارز را بررسی کنید! 🚀`;
      await sendTelegramMessage(chatId, message);
    } else {
      // If we don't find anything, we don't spam the user.
      console.log("[Hunter Cron] No high-quality setups found in this cycle.");
    }

    return NextResponse.json({ success: true, asset: bestAsset });
  } catch (error: any) {
    console.error('Hunter Cron Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
