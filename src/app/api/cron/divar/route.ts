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

    const searchTargets = [
      { category: 'mobile-phones', query: 'آیفون 13 پرو', label: 'iPhone 13 Pro' },
      { category: 'game-consoles', query: 'ps5', label: 'PlayStation 5' },
      { category: 'game-consoles', query: 'پلی استیشن 5', label: 'PlayStation 5' }
    ];

    let foundOpportunities = 0;
    let messageStr = "";

    for (const target of searchTargets) {
      try {
        console.log(`[Divar Cron] Searching for ${target.label}...`);
        const ads = await fetchDivarAds('tehran', target.category, target.query);
        
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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
