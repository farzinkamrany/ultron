import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';
import { fetchDivarAds, findArbitrageOpportunities } from '@/lib/divar';
import { verifyQStashSignature } from '@/lib/qstash';
import { redis } from '@/lib/redis';

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow enough time for proxy requests

export async function POST(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  
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
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID is missing');

    // --- CIRCUIT BREAKER CHECK ---
    const breakerKey = 'divar_circuit_breaker';
    const isBroken = await redis.get(breakerKey);
    if (isBroken) {
      console.log("[Divar Cron] Circuit breaker active. Skipping scan to avoid permanent ban.");
      return NextResponse.json({ success: true, message: "Circuit breaker active. Cooldown in progress." });
    }

    const searchTargets = [
      { category: 'mobile-phones', query: 'آیفون 13 پرو', label: 'iPhone 13 Pro' },
      { category: 'game-consoles', query: 'ps5', label: 'PlayStation 5' },
      { category: 'game-consoles', query: 'پلی استیشن 5', label: 'PlayStation 5' }
    ];

    let foundOpportunities = 0;
    let messageStr = "";
    
    const errorCounterKey = 'divar_consecutive_errors';

    for (const target of searchTargets) {
      try {
        console.log(`[Divar Cron] Searching for ${target.label}...`);
        const ads = await fetchDivarAds('tehran', target.category, target.query);
        
        // If we reach here, the request succeeded. Reset error counter.
        await redis.set(errorCounterKey, 0);

        // Filter out extreme noise
        const realisticAds = ads.filter(ad => {
          if (target.label.includes('iPhone 13') && ad.price < 35000000) return false;
          if (target.label.includes('PlayStation') && ad.price < 18000000) return false;
          return true;
        });

        const { mean, opportunities } = findArbitrageOpportunities(realisticAds, -1.2);

        if (opportunities.length > 0) {
          let categoryHeaderAdded = false;

          // Take top 2 best deals
          const topDeals = opportunities.slice(0, 2);
          for (const deal of topDeals) {
            // Check Redis to avoid duplicate alerts (cache for 24h)
            const redisKey = `divar_alerted:${deal.token}`;
            const alreadyAlerted = await redis.get(redisKey);
            
            if (!alreadyAlerted) {
              if (!categoryHeaderAdded) {
                messageStr += `\n🎯 **شکار در دسته‌بندی ${target.label}**\n`;
                messageStr += `📊 میانگین بازار: **${(mean / 1000000).toFixed(1)} میلیون تومان**\n\n`;
                categoryHeaderAdded = true;
              }

              messageStr += `🔥 **${deal.title}**\n`;
              messageStr += `💵 قیمت آگهی: ${(deal.price / 1000000).toFixed(1)} میلیون\n`;
              messageStr += `🤑 حاشیه سود (تخمینی): **${(deal.profitMargin / 1000000).toFixed(1)} میلیون (${deal.profitPercentage.toFixed(0)}%)**\n`;
              messageStr += `🔗 لینک: ${deal.url}\n\n`;
              
              await redis.setex(redisKey, 86400, "1"); // 24 hours
              foundOpportunities++;
            }
          }
        }
      } catch (err: any) {
        console.error(`Error scraping ${target.label}:`, err.message);
        
        // Increment consecutive error counter
        const currentErrors = (await redis.incr(errorCounterKey)) || 1;
        
        if (currentErrors >= 3) {
          console.error("[Divar Cron] Anti-Bot Circuit Breaker TRIPPED!");
          
          // Activate Circuit Breaker for 2 hours (7200 seconds)
          await redis.setex(breakerKey, 7200, "1");
          
          // Send SOS Alert to Telegram
          const alertMsg = `🚨 **هشدار کوری اسکنر دیوار** 🚨\nدیوار ۳ بار پیاپی درخواست ما را مسدود کرد (احتمال بن شدن IP). من مدارِ اسکنر را قطع کردم تا به مدت ۲ ساعت استراحت کند.\n\nلطفاً در اسرع وقت پروکسی (DIVAR_PROXY) را بررسی یا تعویض کنید.`;
          await sendTelegramMessage(chatId, alertMsg);
          
          // Stop checking other targets in this loop
          break;
        }
      }
    }

    if (foundOpportunities > 0) {
      const finalMsg = `🚨 **آلارم آربیتراژ سایت دیوار** 🚨\n\nسیستم اولتران آگهی‌هایی را پیدا کرد که قیمت آن‌ها به شدت از میانگین بازار پایین‌تر است (احتمالِ سود سریع):\n` + messageStr;
      await sendTelegramMessage(chatId, finalMsg);
    } else {
      console.log("[Divar Cron] No arbitrage opportunities found in this cycle.");
    }

    return NextResponse.json({ success: true, opportunitiesCount: foundOpportunities });
  } catch (error: any) {
    console.error('Divar Cron Error:', error);
    
    // Auto-Heal the error
    const { healError } = await import('@/lib/error-healer');
    await healError(error, "Divar Arbitrage Cron (/api/cron/divar)");

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
