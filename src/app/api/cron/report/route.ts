import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { verifyQStashSignature } from '@/lib/qstash';

export const dynamic = "force-dynamic";

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

  try {
    // 7 Days ago ISO string
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateLimit = sevenDaysAgo.toISOString();

    const { data: trades, error } = await supabase
      .from('paper_trades')
      .select('*')
      .in('status', ['WON', 'LOST'])
      .gte('closed_at', dateLimit);

    if (error) throw error;

    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error("TELEGRAM_CHAT_ID not configured.");

    if (!trades || trades.length === 0) {
      await sendTelegramMessage(chatId, `📊 **گزارش هفتگی اولتران** 📊\n\nدر ۷ روز گذشته هیچ معامله‌ی بسته‌شده‌ای ثبت نشده است. بازار در فاز استراحت است.`);
      return NextResponse.json({ message: "No trades to report." });
    }

    const totalTrades = trades.length;
    let wins = 0;
    let totalPnl = 0;
    let totalWinPnl = 0;
    let totalLossPnl = 0;

    for (const t of trades) {
      if (t.status === 'WON') {
        wins++;
        totalWinPnl += t.pnl || 0;
      } else {
        totalLossPnl += Math.abs(t.pnl || 0);
      }
      totalPnl += t.pnl || 0;
    }

    const winRate = (wins / totalTrades) * 100;
    const avgWin = wins > 0 ? totalWinPnl / wins : 0;
    const avgLoss = (totalTrades - wins) > 0 ? totalLossPnl / (totalTrades - wins) : 0;
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;

    // Compare with Baseline
    const BASELINE_WINRATE = 21.41;
    const wrDiff = winRate - BASELINE_WINRATE;
    const wrIcon = wrDiff >= 0 ? "🟢" : "🔴";
    
    const pnlIcon = totalPnl >= 0 ? "💵" : "🩸";

    const reportMsg = `📊 **کارنامه‌ی هفتگی Paper Trading** 📊\n\n` +
      `تعداد کل معاملات بسته شده: **${totalTrades}**\n` +
      `پوزیشن‌های برنده: **${wins}**\n` +
      `پوزیشن‌های بازنده: **${totalTrades - wins}**\n\n` +
      `🎯 **وین‌ریت واقعی هفته:** %${winRate.toFixed(2)}\n` +
      `${wrIcon} انحراف از بک‌تست (۲۱.۴۱٪): ${wrDiff > 0 ? '+' : ''}${wrDiff.toFixed(2)}%\n\n` +
      `⚖️ **میانگین R:R سیستم:** ${avgRR.toFixed(2)}\n` +
      `${pnlIcon} **سود/ضرر خالص (PnL):** $${totalPnl.toFixed(2)}\n\n` +
      (totalPnl >= 0 
        ? `✅ **وضعیت سالم:** اولتران با موفقیت برتریِ ریاضی خود را در بازار لایو حفظ کرده است!`
        : `⚠️ **وضعیت هشدار:** سیستم در فاز فرسایشی (Drawdown) قرار دارد. اما مدارشکن همچنان از سرمایه محافظت می‌کند.`);

    await sendTelegramMessage(chatId, reportMsg);

    return NextResponse.json({ success: true, report: { totalTrades, winRate, avgRR, totalPnl } });

  } catch (err: any) {
    console.error("Report Cron Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

