import fetch from 'node-fetch';

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ultron-assistant-iota.vercel.app';
const dashboardUrl = `${appUrl}/dashboard/trading`;

if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set in .env.local');
  process.exit(1);
}

async function setMenuButton() {
  const url = `https://api.telegram.org/bot${token}/setChatMenuButton`;
  const payload = {
    menu_button: {
      type: 'web_app',
      text: '📊 Dashboard',
      web_app: {
        url: dashboardUrl
      }
    }
  };

  try {
    console.log(`Setting Telegram Menu Button to point to: ${dashboardUrl}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.ok) {
      console.log('✅ Successfully set Telegram Menu Button!');
    } else {
      console.error('❌ Failed to set Menu Button:', data.description);
    }
  } catch (err) {
    console.error('❌ Error calling Telegram API:', err.message);
  }
}

setMenuButton();
