import { sendTelegramMessage } from '../src/lib/telegram';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function goLive() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.error("No TELEGRAM_CHAT_ID found in .env.local");
    return;
  }
  
  const msg = `🟢 **موتور Paper Trading آنلاین شد! (Phase 3 Active)** 🟢\n\n` +
    `گزارش بک‌تست (فاز ۲) با موفقیت بایگانی شد.\n\n` +
    `🤖 **Ultron V10** اکنون مستقیماً به جریان زنده‌ی بایننس متصل شده است و هر ۵ دقیقه بازار را اسکن می‌کند.\n` +
    `💰 معاملات بر اساس ریاضیات گَن و نقدینگیِ SMC استخراج شده و در دیتابیس Supabase ذخیره خواهند شد.\n\n` +
    `من به طور ۲۴ ساعته بازار را رصد می‌کنم و به محض پیدا کردن یک R:R استثنایی بالای ۲.۰، به شما هشدار می‌دهم. کمربندها را ببندید! 🚀`;
    
  await sendTelegramMessage(chatId, msg);
  console.log("Live message sent successfully.");
}

goLive().catch(console.error);
