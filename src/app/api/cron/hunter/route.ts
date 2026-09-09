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
    // 1. GLOBAL CIRCUIT BREAKER (Trailing Drawdown 25%)
    const { data: allTrades } = await supabase.from('paper_trades').select('pnl, created_at').not('pnl', 'is', null).order('created_at', { ascending: true });
    
    let currentBalance = 1000;
    let peakBalance = 1000;
    
    if (allTrades) {
      for (const t of allTrades) {
        currentBalance += (t.pnl || 0);
        if (currentBalance > peakBalance) {
          peakBalance = currentBalance;
        }
      }
    }
    
    const maxAllowedDrawdown = peakBalance * 0.25;
    if (peakBalance - currentBalance >= maxAllowedDrawdown) {
      console.error(`[SHIELD PROTOCOL] 25% Trailing Drawdown hit. Peak: $${peakBalance}, Current: $${currentBalance}. Halting trading.`);
      return NextResponse.json({ message: 'SHIELD PROTOCOL: 25% TRAILING DRAWDOWN ACTIVE - TRADING HALTED' });
    }

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

    // 1.5 LIQUIDITY CEILING DETECTOR (Protocol V13.0)
    if (currentBalance >= 1000000) {
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (chatId) {
        await sendTelegramMessage(chatId, `🚨 **سقف نقدینگی صرافی پر شد!** 🚨\n\nموجودی استراتژی از مرز ۱ میلیون دلار عبور کرد. سفارشاتِ ما آنقدر بزرگ شده‌اند که صرافی بای‌بیت دیگر توان پر کردن آن‌ها را بدون لغزش شدید (Slippage) ندارد.\n\n🛑 **دستور:** لطفاً پول‌ها را نقد کنید، حساب را پاک‌سازی کنید و دوباره فقط با ۱۰۰۰ دلار استارت بزنید!`);
      }
      return NextResponse.json({ message: 'LIQUIDITY CEILING REACHED - TRADING HALTED' });
    }

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
