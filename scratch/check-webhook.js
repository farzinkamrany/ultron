import { fetch } from 'undici';

const token = "8823728904:AAHYBgD40KCnWBGBcP924GXCvfTw2caZ6HM";

async function check() {
  // Check webhook info
  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log("=== Webhook Info ===");
  console.log(JSON.stringify(info.result, null, 2));

  // Check pending updates
  const updatesRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=5&offset=-5`);
  const updates = await updatesRes.json();
  console.log("\n=== Recent Updates ===");
  for (const update of updates.result || []) {
    console.log(`Update ID: ${update.update_id}`);
    console.log(`Text: ${update.message?.text}`);
    console.log(`Date: ${new Date(update.message?.date * 1000).toISOString()}`);
    console.log("---");
  }
}

check().catch(console.error);
