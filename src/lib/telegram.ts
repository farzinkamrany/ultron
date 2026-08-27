import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";

export async function sendTelegramMessage(chatId: string | number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("[Telegram] Token not set. Cannot send message.");
    return;
  }

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const fetchUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const urlObj = new URL(fetchUrl);
  
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" });
  
  const options: https.RequestOptions = {
    hostname: urlObj.hostname,
    path: urlObj.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : {}),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
