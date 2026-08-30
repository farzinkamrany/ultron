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

export async function getTelegramFileBuffer(fileId: string): Promise<Buffer | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const info = await infoRes.json();
    if (!info.ok) {
      console.error("[Telegram] getFile error:", info);
      return null;
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("[Telegram] Download failed:", error);
    return null;
  }
}

export async function sendTelegramVoice(chatId: string | number, audioBuffer: Buffer) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("voice", new Blob([new Uint8Array(audioBuffer)], { type: "audio/mp3" }), "voice.mp3");

    const response = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      console.error("[Telegram] sendVoice error response:", await response.text());
    }
  } catch (error) {
    console.error("[Telegram] sendVoice failed:", error);
  }
}
