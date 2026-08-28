import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not defined' }, { status: 400 });
    }

    // 1. Read host URL
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    
    // 2. Construct webhook URL
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;

    // 3. Call Telegram API to set Webhook
    const telegramApiUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    
    const response = await fetch(telegramApiUrl);
    const data = await response.json();

    // 4. Return Telegram API response
    return NextResponse.json({
      webhookUrl,
      telegramResponse: data
    });
  } catch (error: any) {
    console.error('Webhook Setup Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
