import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ccxt from 'ccxt';
import fetch from 'node-fetch';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

import { HttpsProxyAgent } from 'https-proxy-agent';

let agent;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  agent = new HttpsProxyAgent(proxyUrl);
}

const exchange = new ccxt.hyperliquid(agent ? { agent } : {});

async function sendTelegramMessage(chatId: string | number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('Telegram error:', e);
  }
}

async function main() {
  console.log('Fetching Behemoth live status...');
  
  const { data: openTrades, error } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', 'OPEN')
    .ilike('rationale', '%[BEHEMOTH]%');

  if (error) {
    console.error('Supabase error:', error.message);
    return;
  }

  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.error('No Telegram Chat ID found in environment.');
    return;
  }

  if (!openTrades || openTrades.length === 0) {
    await sendTelegramMessage(chatId, `👑 <b>BEHEMOTH STATUS</b> 👑\n\n💤 No active grids right now. Waiting for ranges...`);
    console.log('Sent idle status to Telegram.');
    return;
  }

  const fetchSymbols = openTrades.map(t => `${t.symbol.split('/')[0]}/USDC:USDC`);
  const tickers = await exchange.fetchTickers(fetchSymbols);
  
  let totalPnl = 0;
  let totalMargin = 0;
  let lines = [];

  for (const trade of openTrades) {
    const hyperSymbol = `${trade.symbol.split('/')[0]}/USDC:USDC`;
    const livePrice = tickers[hyperSymbol]?.last || trade.entry_price;
    const isLong = trade.position_type === 'LONG';
    const diff = isLong ? (livePrice - trade.entry_price) : (trade.entry_price - livePrice);
    const pnlUsd = (diff / trade.entry_price) * trade.position_size_usd;

    totalPnl += pnlUsd;
    totalMargin += trade.position_size_usd;

    const emoji = pnlUsd >= 0 ? '🟢' : '🔴';
    lines.push(`${emoji} <b>${trade.symbol}</b> | $${trade.position_size_usd.toFixed(0)} | ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}`);
  }

  const header = `👑 <b>BEHEMOTH LIVE REPORT</b> 👑\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  const body = lines.join('\n');
  const footer = `\n━━━━━━━━━━━━━━━━━━━━━━\n💰 <b>Margin In Use:</b> $${totalMargin.toFixed(2)}\n💵 <b>Unrealized PNL:</b> ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`;

  const finalMessage = header + body + footer;
  
  await sendTelegramMessage(chatId, finalMessage);
  console.log('✅ Sent Behemoth status to Telegram successfully!');
}

main().catch(console.error);
