import { fetch } from 'undici';

const token = "8823728904:AAHYBgD40KCnWBGBcP924GXCvfTw2caZ6HM";
const chatId = "142499768";

async function send() {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ **Ultron System Test**\n\nThis is a test message from your local development environment to confirm that the Telegram bot is working properly!\n\nWe are now ready for the V3.5 UI & Voice expansions.",
        parse_mode: "Markdown"
      })
    });
    
    console.log("Status Code:", response.status);
    console.log("Response:", await response.text());
  } catch (error) {
    console.error("Error sending message:", error.message);
  }
}

send();


