import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/lib/ai';
import { sendTelegramMessage, sendTelegramVoice } from '@/lib/telegram';
import { verifyQStashSignature } from '@/lib/qstash';
import { generateSpeech } from '@/lib/audio';
import ccxt from 'ccxt';
import { HttpsProxyAgent } from 'https-proxy-agent';

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
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const exchange = new ccxt.binance({ enableRateLimit: true });
    
    if (proxyUrl) {
      exchange.httpsProxy = proxyUrl;
    }

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

    // 2. Generate Podcast Script
    const prompt = `System Directive: You are Ultron, a highly intelligent and charismatic AI assistant created by Farzin. 
It is morning time. You are hosting a short, 1-minute daily crypto podcast exclusively for Farzin.

Current Market Status:
- Bitcoin Price: ${btcPrice}
- 24h Change: ${btcChange} (${trendWord})

Your task: Write a highly engaging, energetic, and slightly futuristic Persian script (2 short paragraphs max) to give him a morning briefing.
Start by saying good morning to Farzin. Give him a quick wrap-up of what Bitcoin is doing based on the data above.
Then, motivate him for his day job, reminding him that the algorithms and AI (you) are working hard in the background to build his trading empire.
Use a professional yet warm "brotherly" tone. 
CRITICAL RULE: DO NOT use any emojis, asterisks (*), hashtags, or special characters in the text, as it will be read by a Text-To-Speech engine. Use simple, easily readable Persian phrasing. Spell out numbers clearly if necessary.`;

    const aiScript = await generateAIResponse([{ role: 'user', content: prompt }], false, false); // Using flash model for speed
    
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not defined');
    }

    // 3. Convert to Voice (ElevenLabs)
    try {
      const audioBuffer = await generateSpeech(aiScript);
      
      // 4. Send Voice Message
      await sendTelegramVoice(chatId, audioBuffer);
      
      // Also send the text as a caption/follow-up
      await sendTelegramMessage(chatId, `🎙️ **پادکست صبحگاهی اولتران**\n\nمتن پادکست:\n${aiScript}`);

    } catch (audioError) {
      console.error("[Morning Podcaster] Audio Generation/Send Error:", audioError);
      // Fallback to text only
      await sendTelegramMessage(chatId, `🌅 **بریفینگ صبحگاهی (خطا در تولید صدا)**\n\n${aiScript}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Morning Cron Error:', error);
    
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
