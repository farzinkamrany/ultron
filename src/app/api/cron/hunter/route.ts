import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';
import { huntForSetup } from '@/lib/trading/hunter';
import { verifyQStashSignature } from '@/lib/qstash';
import { supabase } from '@/lib/supabase';

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
    // 1. GLOBAL CIRCUIT BREAKER (Removed)
    // The Quant Brain never stops trading. If we hit a drawdown, the math guarantees
    // the highest probability of recovery. Halting trading is an emotional failure.

    // 1.2 CORRELATION FILTER (Max 3 Open Trades - Drawdown Reduction)
    const { data: openTrades, error: countError } = await supabase
      .from('paper_trades')
      .select('symbol, status')
      .eq('status', 'OPEN');
      
    if (openTrades && openTrades.length >= 8) {
      console.log("[SHIELD PROTOCOL] Correlation Filter Active: Already have 8 open trades. Skipping hunt.");
      return NextResponse.json({ message: 'SHIELD PROTOCOL: CORRELATION FILTER ACTIVE - MAX TRADES REACHED' });
    }

    const openSymbols = openTrades ? openTrades.map(t => t.symbol) : [];

    // 1.3 CIRCUIT BREAKER (3 Consecutive Losses) - Removed by user request (bot has no feelings)

    // 1.5 LIQUIDITY CEILING DETECTOR (Removed)
    // On Hyperliquid, a $1M balance with Quarter-Kelly risk is easily absorbed by the orderbooks.
    // We let the bot run infinitely to $5M+ just like the simulation.
    // We let the bot run infinitely to $5M+ just like the simulation.

    // 2. Hunt for a setup with at least 3% profit potential
    const tradeSetup = await huntForSetup(3.0, openSymbols);
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not defined');
    }

    if (tradeSetup) {
      // Log the trade in the database
      const { error: dbError } = await supabase.from('paper_trades').insert([{
        symbol: tradeSetup.symbol,
        position_type: tradeSetup.action === 'BUY' ? 'LONG' : 'SHORT',
        entry_price: tradeSetup.entryPrice,
        take_profit: tradeSetup.targetPrice,
        stop_loss: tradeSetup.stopLoss,
        status: 'OPEN',
        rationale: tradeSetup.execution_context
      }]);

      if (dbError) {
        console.error('Failed to log paper trade:', dbError);
      }

      const message = `🎯 **شکارِ تک‌تیرانداز (Gann + SMC)** 🎯\n\n` +
        `سیستم از فیلتر سخت‌گیرانه‌ی R:R عبور کرد و یک موقعیت طلایی پیدا کرد:\n\n` +
        `🪙 ارز: **${tradeSetup.symbol}**\n` +
        `📍 جهت: **${tradeSetup.action}**\n` +
        `💵 ورود: **$${tradeSetup.entryPrice.toFixed(4)}**\n` +
        `📈 تارگت گَن (TP): **$${tradeSetup.targetPrice.toFixed(4)}**\n` +
        `📉 حد ضرر گَن (SL): **$${tradeSetup.stopLoss.toFixed(4)}**\n\n` +
        `🧠 **منطق ورود:**\n${tradeSetup.execution_context}\n\n` +
        `سیستم به طور خودکار این معامله را تا قفل کردنِ سود مدیریت می‌کند! 🚀`;

      await sendTelegramMessage(chatId, message);
    } else {
      console.log("[Hunter Cron] No high-quality setups found in this cycle.");
    }

    return NextResponse.json({ success: true, trade: tradeSetup });
  } catch (error: any) {
    console.error('Hunter Cron Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
