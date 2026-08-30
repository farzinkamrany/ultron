export async function sendTelegramMessage(chatId: string | number, text: string, reply_markup?: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[Telegram] Token not set. Cannot send message.");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup }),
    });

    if (!response.ok) {
      console.error("[Telegram] Error response:", await response.text());
    }

    return await response.json().catch(() => null);
  } catch (error) {
    console.error("[Telegram] Request failed:", error);
    throw error;
  }
}

export async function sendTelegramAction(chatId: string | number, action: string = 'typing') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (error) {
    console.error("[Telegram] Action failed:", error);
  }
}
