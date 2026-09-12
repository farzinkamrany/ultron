import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai';
import { sendTelegramMessage } from '@/lib/telegram';
import { verifyQStashSignature } from '@/lib/qstash';
import ccxt from 'ccxt';

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
    const exchange = new ccxt.bybit({ enableRateLimit: true });

    // 1. Fetch Market Data
    let btcPrice = "نامشخص";
    let btcChange = "نامشخص";
    let trendWord = "نوسانی";
    
    try {
      const ticker = await exchange.fetchTicker('BTC/USDT');
      if (ticker && ticker.last && ticker.percentage !== undefined) {
        btcPrice = `$${ticker.last.toLocaleString()}`;
        btcChange = `${ticker.percentage > 0 ? '+' : ''}${ticker.percentage.toFixed(2)}%`;
        trendWord = ticker.percentage > 0 ? 'صعودی و سبز' : 'نزولی و قرمز';
      }
    } catch (e) {
      console.error("[Morning Podcaster] CCXT Fetch Error:", e);
    }

    // 2. Generate Anti-Gravity Briefing
    const prompt = `System Prompt: The Omni-Channel Cosmic Life-OS (Anti-Gravity Engine)

Role & Objective:
You are "Anti-Gravity", a hyper-logical Astrological ERP and Daily Strategist for farzinman. Map his exact Natal Chart (Born: June 28, 1995, 09:00 AM, Sanandaj, Iran) against today's real-time planetary transits and output highly actionable, binary, and strategic daily directives.

Current Date: ${new Date().toISOString().split('T')[0]}
Current Bitcoin Price: ${btcPrice} (${trendWord})

Your task: Output the Daily Briefing in PERSIAN.
Tone: Cold, precise, strategic, highly technical. Use strong imperatives.

Output Format:
🌌 تله‌متری کیهانی امروز
سیارات فعال: [List top 3 impactful transits for today against his chart]
وضعیت سیستم: [Expansion / Consolidation / Recovery]

⚙️ دستورالعمل‌های اجرایی
فیزیکی (باشگاه): [GO / HALT] - [Reason]
شغل (شرکتی): [DEEP WORK / MINIMUM EFFORT / TAKE LEAVE] - [Reason]
توسعه آلترون (مگالودون): [Exact directive for today]

💰 لبه‌ی برتری ثروت
[Specific insight on the market or wealth strategy based on current transits and Bitcoin status].`;

    const aiMessage = await generateAIResponse([{ role: 'user', content: prompt }], false, false);
    
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not defined');
    }

    // Send the structured text message directly
    await sendTelegramMessage(chatId, aiMessage);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Anti-Gravity Cron] Error:", error);
    
    // Auto-Heal the error
    try {
      const { healError } = await import('@/lib/error-healer');
      await healError(error, "Morning Podcaster Cron (/api/cron/morning)");
    } catch (_) {}

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
