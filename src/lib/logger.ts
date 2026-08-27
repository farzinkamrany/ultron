import { supabase } from "./supabase";
import { sendTelegramMessage } from "./telegram";

type LogLevel = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export async function logError(
  context: string,
  error: any,
  metadata: any = {},
  isCritical: boolean = false
) {
  const message = error instanceof Error ? error.message : String(error);
  const stack_trace = error instanceof Error ? error.stack : null;
  const level: LogLevel = isCritical ? "CRITICAL" : "ERROR";

  console.error(`[${level}] ${context}: ${message}`);

  // 1. Store in Supabase
  try {
    await supabase.from("system_logs").insert([{
      level,
      context,
      message,
      stack_trace,
      metadata
    }]);
  } catch (dbErr) {
    console.error("Failed to write to system_logs:", dbErr);
  }

  // 2. Alert via Telegram if critical
  if (isCritical) {
    try {
      const alertMsg = `🚨 <b>SYSTEM DEGRADED</b>\n\n<b>Context:</b> ${context}\n<b>Error:</b> ${message}\n\n<i>Check Supabase system_logs for stack trace.</i>`;
      await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID as string, alertMsg);
    } catch (tgErr) {
      console.error("Failed to send Telegram alert:", tgErr);
    }
  }
}

