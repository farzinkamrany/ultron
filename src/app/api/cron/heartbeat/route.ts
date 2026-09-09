import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import ccxt from 'ccxt';
import { verifyQStashSignature } from '@/lib/qstash';

export const dynamic = "force-dynamic";
export const maxDuration = 30; // 30s timeout

export async function GET(req: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  
  if (!isDev) {
    const isQStash = !!req.headers.get('upstash-signature');
    const isVercelCron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
    
    if (isQStash) {
      const isValid = await verifyQStashSignature(req);
      if (!isValid) return new NextResponse('Unauthorized', { status: 401 });
    } else if (!isVercelCron) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const errors: string[] = [];

  try {
    // 1. Check Supabase Connectivity
    const { error: dbError } = await supabase.from('paper_trades').select('id').limit(1);
    if (dbError) {
      errors.push(`❌ **Supabase Database Error:**\n${dbError.message}`);
    }

    // 2. Check Hyperliquid Data Staleness
    try {
      const exchange = new ccxt.hyperliquid({ enableRateLimit: true, options: { defaultType: 'swap' } });
      // Timeout specifically for the API call to avoid hanging
      const fetchPromise = exchange.fetchOHLCV('BTC/USDC:USDC', '5m', undefined, 1);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Exchange API Timeout")), 10000));
      
      const ohlcv = await Promise.race([fetchPromise, timeoutPromise]) as any[];
      
      if (!ohlcv || ohlcv.length === 0) {
        errors.push(`❌ **Exchange Error:** No data received from Hyperliquid.`);
      } else {
        const lastCandleTime = ohlcv[0][0];
        const currentTime = Date.now();
        const diffMinutes = (currentTime - lastCandleTime) / (1000 * 60);

        if (diffMinutes > 15) {
          errors.push(`❌ **Data Staleness Warning:**\nHyperliquid API is returning old data! Last candle is ${Math.round(diffMinutes)} minutes old (Threshold: 15m).`);
        }
      }
    } catch (e: any) {
      errors.push(`❌ **Exchange Connection Error:**\n${e.message || 'Failed to connect to Hyperliquid'}`);
    }

    // 3. Trigger Alert if any errors found
    if (errors.length > 0) {
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (chatId) {
        const alertMsg = `🚨 **اخطار قرمز: سیستم در خطر است (KILL-SWITCH)** 🚨\n\n` +
          `سگ نگهبانِ اولتران یک قطعیِ حیاتی در شریان‌های سیستم پیدا کرده است:\n\n` +
          `${errors.join('\n\n')}\n\n` +
          `⚠️ لطفاً فوراً داشبورد Vercel و لاگ‌های سرور را بررسی کنید! سیستم تا زمان رفع مشکل ممکن است کور باشد.`;
        
        await sendTelegramMessage(chatId, alertMsg);
      }
      return NextResponse.json({ status: 'error', details: errors }, { status: 500 });
    }

    return NextResponse.json({ status: 'healthy', message: 'All systems operational.' });
  } catch (globalError: any) {
    console.error("Critical Heartbeat Failure:", globalError);
    // Try to send final distress signal
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (chatId) {
      await sendTelegramMessage(chatId, `🚨 **CRITICAL SERVER FAILURE** 🚨\nHeartbeat script crashed entirely: ${globalError.message}`);
    }
    return NextResponse.json({ status: 'critical_failure', error: globalError.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

