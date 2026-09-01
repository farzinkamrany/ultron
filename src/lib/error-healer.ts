import crypto from 'crypto';
import { redis } from '@/lib/redis';
import { sendTelegramMessage } from '@/lib/telegram';
import { startCtoWorkflow } from '@/lib/cto/orchestrator';

/**
 * Handles a fatal system error by automatically alerting the admin
 * and assigning the AI CTO to investigate and create a pull request.
 * 
 * Includes a 24-hour Redis circuit breaker to prevent infinite CTO loops.
 * 
 * @param error The Error object caught in the catch block
 * @param context A string describing where the error occurred (e.g. "Divar Cron")
 */
export async function healError(error: Error, context: string) {
  try {
    const errorStr = `${error.name}: ${error.message}`;
    const stackStr = error.stack || "No stack trace available";
    
    // 1. Create a unique hash for this specific error to debounce it
    const hashInput = `${context}-${errorStr}`;
    const hash = crypto.createHash('md5').update(hashInput).digest('hex');
    const lockKey = `healer_lock:${hash}`;

    // 2. Check if the CTO is already working on this exact error
    const isLocked = await redis.get(lockKey);
    if (isLocked) {
      console.log(`[Auto-Healer] CTO is already working on this error (${hash}). Suppressing duplicate trigger.`);
      return;
    }

    // 3. Lock it for 24 hours (86400 seconds) to prevent infinite loops
    await redis.setex(lockKey, 86400, "locked");

    // 4. Send SOS Alert to Telegram
    const adminChatId = process.env.TELEGRAM_CHAT_ID;
    if (adminChatId) {
      const alertMsg = `🚨 **سیستم با خطای بحرانی مواجه شد!** 🚨\n\n` +
        `**محل بروز ارور:** ${context}\n` +
        `**نوع ارور:** ${errorStr}\n\n` +
        `🛠️ من مدیر فنی (CTO) را در بک‌گراند بیدار کردم. او در حال بررسی سورس کد است و به زودی مشکل را در گیت‌هاب برطرف می‌کند...`;
      await sendTelegramMessage(adminChatId, alertMsg);
    }

    // 5. Formulate the highly technical prompt for the CTO
    const prompt = `[AUTO-HEALING REQUEST] 
A fatal error occurred in the production system.

Context: ${context}
Error Message: ${errorStr}
Stack Trace:
${stackStr}

Your mission:
1. Research the codebase to find where this error originated.
2. Develop a fix and propose a Pull Request using the 'write_and_propose_code' tool.
3. Keep the user updated on your progress.`;

    // 6. Wake up the CTO and push to QStash worker
    await startCtoWorkflow(prompt, adminChatId || "");

  } catch (healerError) {
    // If the healer itself crashes, log it safely so we don't cause an infinite loop
    console.error("[Auto-Healer] FATAL: Healer crashed while trying to heal another error:", healerError);
  }
}
