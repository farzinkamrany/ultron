import { NextRequest, NextResponse } from 'next/server';
import ccxt from 'ccxt';
import { sendTelegramMessage } from '@/lib/telegram';
import { verifyQStashSignature } from '@/lib/qstash';

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Configurable APIs for Iranian Exchange Rates (Fallback to public known APIs or mock for now)
// Ideally, the user will replace these with exact endpoints (e.g. Navasan, Nobitex, etc.)
const LOCAL_API_TETHER = process.env.LOCAL_API_TETHER || 'https://api.nobitex.ir/market/stats';
const LOCAL_API_EURO = process.env.LOCAL_API_EURO || 'https://api.navasan.tech/latest/?item=eur';

async function fetchLocalRates() {
  // Mocking/Fallback logic until exact Iranian APIs are plugged in
  let tetherIrt = 60000; // 60,000 Toman
  let euroIrt = 65000;   // 65,000 Toman

  try {
    // Nobitex Tether (USDT/IRT)
    const nobitexRes = await fetch('https://api.nobitex.ir/market/stats');
    if (nobitexRes.ok) {
      const data = await nobitexRes.json();
      if (data?.stats?.['usdt-irt']?.latest) {
        tetherIrt = parseInt(data.stats['usdt-irt'].latest) / 10; // Convert Rial to Toman
      }
    }
  } catch (e) {
    console.warn("[Project Berlin] Failed to fetch Tether price from Nobitex", e);
  }

  try {
    // Navasan Euro (EUR/IRT) requires API Key, fallback to mock if fails
    const navasanKey = process.env.NAVASAN_API_KEY;
    if (navasanKey) {
      const navasanRes = await fetch(`https://api.navasan.tech/latest/?api_key=${navasanKey}&item=eur`);
      if (navasanRes.ok) {
        const data = await navasanRes.json();
        if (data?.eur?.value) {
          euroIrt = parseInt(data.eur.value) / 10; // Convert Rial to Toman (assuming navasan gives Rial)
        }
      }
    } else {
      // Temporary heuristic if no key: Euro is usually ~1.08x Tether
      euroIrt = Math.floor(tetherIrt * 1.085);
    }
  } catch (e) {
    console.warn("[Project Berlin] Failed to fetch Euro price", e);
  }

  return { tetherIrt, euroIrt };
}

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

    // 1. Fetch Global Rate (Binance)
    const ticker = await exchange.fetchTicker('EUR/USDT');
    const eurUsdtRate = ticker.last; // 1 EUR = X USDT

    if (!eurUsdtRate) throw new Error("Could not fetch EUR/USDT from Binance");

    // 2. Fetch Local Rates
    const { tetherIrt, euroIrt } = await fetchLocalRates();

    // 3. Arbitrage Logic (Capital = 100M Toman)
    const capitalIrt = 100_000_000;

    // Path A (Direct): Buy Euro with Toman
    const directEuroReceived = capitalIrt / euroIrt;

    // Path B (Indirect): Buy USDT with Toman, then buy Euro on Binance
    const usdtReceived = capitalIrt / tetherIrt;
    const indirectEuroReceived = usdtReceived / eurUsdtRate;

    // 4. Calculate Difference
    const diffEuros = indirectEuroReceived - directEuroReceived;
    const profitMarginPercent = (diffEuros / directEuroReceived) * 100;

    const thresholdPercent = process.env.BERLIN_PROFIT_THRESHOLD_PERCENT ? parseFloat(process.env.BERLIN_PROFIT_THRESHOLD_PERCENT) : 0.5;

    // If Indirect is better than Direct by more than X%
    if (profitMarginPercent >= thresholdPercent) {
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (chatId) {
        const message = `🚨 **[PROJECT GOLD USDT] - هشدار آربیتراژ برلین** 💶
        
**سود آربیتراژ:** \`${profitMarginPercent.toFixed(2)}%\` 🟢

**محاسبه (سرمایه فرضی ۱۰۰ میلیون تومان):**
➖ خرید مستقیم یورو در ایران: \`${Math.floor(directEuroReceived)} EUR\` (قیمت هر یورو: ${euroIrt.toLocaleString()} تومان)
➖ خرید تتر و تبدیل به یورو در بایننس: \`${Math.floor(indirectEuroReceived)} EUR\` (تتر: ${tetherIrt.toLocaleString()}، بایننس: ${eurUsdtRate.toFixed(4)})

**اختلاف سود خالص:** \`${Math.floor(diffEuros)} EUR\`
        
⚡ سریعاً بررسی کنید!`;

        await sendTelegramMessage(chatId, message);
      }
    }

    return NextResponse.json({ 
      success: true, 
      rates: { tetherIrt, euroIrt, eurUsdtRate },
      arbitrage: { profitMarginPercent, directEuroReceived, indirectEuroReceived }
    });

  } catch (error: any) {
    console.error('Project Berlin Error:', error);
    
    // Auto-Heal the error
    try {
      const { healError } = await import('@/lib/error-healer');
      await healError(error, "Project Berlin Cron (/api/cron/berlin)");
    } catch (_) {}

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
