import { fetch } from 'undici';

const token = "8823728904:AAHYBgD40KCnWBGBcP924GXCvfTw2caZ6HM";

async function check() {
  try {
    const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
    const response = await fetch(url);
    const data = await response.json();
    console.log(data);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

check();
