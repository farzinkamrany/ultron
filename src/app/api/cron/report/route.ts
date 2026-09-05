import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { verifyQStashSignature } from '@/lib/qstash';
import { detectMarketRegime } from '@/lib/trading/risk';

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
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // This week's closed trades
    const { data: thisWeekTrades, error } = await supabase
      .from('paper_trades')
      .select('*')
      .in('status', ['WON', 'LOST'])
      .gte('closed_at', sevenDaysAgo.toISOString());

    if (error) throw error;

    // Last week's closed trades (for comparison)
    const { data: lastWeekTrades } = await supabase
      .from('paper_trades')
      .select('pnl, status')
      .in('status', ['WON', 'LOST'])
      .gte('closed_at', fourteenDaysAgo.toISOString())
      .lt('closed_at', sevenDaysAgo.toISOString());

    // All-time PnL to estimate current balance
    const { data: allTrades } = await supabase
      .from('paper_trades')
      .select('pnl')
      .in('status', ['WON', 'LOST']);

    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error("TELEGRAM_CHAT_ID not configured.");

    // --- ATR Regime Detection ---
    let regime = 'WILD';
    try {
      regime = await detectMarketRegime('BTC/USDT');
    } catch { /* silent */ }

    // --- This Week Stats ---
    const totalTrades = thisWeekTrades?.length || 0;
    let wins = 0, totalPnl = 0, totalWinPnl = 0, totalLossPnl = 0;

    for (const t of thisWeekTrades || []) {
      if (t.status === 'WON') { wins++; totalWinPnl += t.pnl || 0; }
      else { totalLossPnl += Math.abs(t.pnl || 0); }
      totalPnl += t.pnl || 0;
    }

    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgWin = wins > 0 ? totalWinPnl / wins : 0;
    const avgLoss = (totalTrades - wins) > 0 ? totalLossPnl / (totalTrades - wins) : 0;
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;

    // --- Last Week PnL for comparison ---
    const lastWeekPnl = (lastWeekTrades || []).reduce((s, t) => s + (t.pnl || 0), 0);
    const pnlDiff = totalPnl - lastWeekPnl;
    const weekTrend = pnlDiff >= 0 ? `📈 +$${pnlDiff.toFixed(2)} نسبت به هفته قبل` : `📉 $${pnlDiff.toFixed(2)} نسبت به هفته قبل`;

    // --- Estimated account balance ---
    const allTimePnl = (allTrades || []).reduce((s, t) => s + (t.pnl || 0), 0);
    const estimatedBalance = 1000 + allTimePnl;

    // --- Baseline comparison ---
    const BASELINE_WINRATE = 21.41;
    const wrDiff = winRate - BASELINE_WINRATE;
    const wrIcon = wrDiff >= 0 ? "🟢" : "🔴";
    const regimeEmoji = regime === 'CALM' ? '🟩 CALM (ریسک ۱.۵٪)' : '🟥 WILD (ریسک ۰.۵٪)';

    const reportMsg =
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>کارنامه‌ی هفتگی اولتران</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `💰 <b>بالانسِ تخمینی:</b> $${estimatedBalance.toFixed(2)}\n` +
      `🌡️ <b>رژیمِ ATR بازار:</b> ${regimeEmoji}\n\n` +
      `━━━ آمارِ هفته ━━━\n` +
      `📌 تعداد معاملات: <b>${totalTrades}</b>\n` +
      `✅ برنده: <b>${wins}</b>  |  ❌ بازنده: <b>${totalTrades - wins}</b>\n` +
      `🎯 وین‌ریت: <b>${winRate.toFixed(1)}%</b>  ${wrIcon} (انحراف: ${wrDiff > 0 ? '+' : ''}${wrDiff.toFixed(1)}% از بک‌تست)\n` +
      `⚖️ نسبت R:R: <b>${avgRR.toFixed(2)}</b>\n\n` +
      `━━━ سود/ضرر ━━━\n` +
      `${totalPnl >= 0 ? '💵' : '🩸'} <b>PnL هفتگی:</b> $${totalPnl.toFixed(2)}\n` +
      `${weekTrend}\n\n` +
      (totalPnl >= 0
        ? `✅ <b>وضعیت: سالم</b> — اولتران برتریِ ریاضی خود را حفظ کرده است.`
        : `⚠️ <b>وضعیت: Drawdown</b> — سیستم در فاز فرسایشی است. Kill Switch فعال است.`);

    await sendTelegramMessage(chatId, reportMsg);

    return NextResponse.json({ success: true, report: { totalTrades, winRate, avgRR, totalPnl, estimatedBalance, regime } });

  } catch (err: any) {
    console.error("Report Cron Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

