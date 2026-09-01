import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

let agent: any = undefined;
try {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxyUrl) {
    agent = new HttpsProxyAgent(proxyUrl);
  }
} catch (e) {}

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
      agent
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
      agent
    });
  } catch (error) {
    console.error("[Telegram] Action failed:", error);
  }
}

export async function getTelegramFileBuffer(fileId: string): Promise<Buffer | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, { agent });
    const info = (await infoRes.json()) as any;
    if (!info.ok) {
      console.error("[Telegram] getFile error:", info);
      return null;
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
    const fileRes = await fetch(fileUrl, { agent });
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
    // node-fetch supports native FormData or form-data package.
    // For node-fetch v2, we should use form-data. Let's try FormData from undici if available, 
    // or just construct a multipart body manually. But actually, Node 18+ FormData works with node-fetch v2.
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("voice", new Blob([new Uint8Array(audioBuffer)], { type: "audio/mp3" }), "voice.mp3");

    const response = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: "POST",
      body: formData as any,
      agent
    });

    if (!response.ok) {
      console.error("[Telegram] sendVoice error response:", await response.text());
    }
  } catch (error) {
    console.error("[Telegram] sendVoice failed:", error);
  }
}


