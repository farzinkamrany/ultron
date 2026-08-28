// Run this once to clear stale/corrupt Redis chat history that may contain
// unresolved functionCall entries causing the LLM to loop immediately on "hi"
const fs = require('fs');
const { ProxyAgent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:10808'));

const env = fs.readFileSync('.env.local', 'utf-8');

function getEnv(key) {
  const match = env.match(new RegExp(`^${key}=(.+)`, 'm'));
  return match?.[1]?.trim();
}

const REDIS_URL = getEnv('UPSTASH_REDIS_REST_URL');
const REDIS_TOKEN = getEnv('UPSTASH_REDIS_REST_TOKEN');
const CHAT_ID = getEnv('TELEGRAM_CHAT_ID');

async function clearHistory() {
  const key = `chat_history:${CHAT_ID}`;
  const res = await fetch(`${REDIS_URL}/del/${key}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  const data = await res.json();
  console.log(`Cleared Redis key "${key}":`, data);
}

clearHistory().catch(console.error);
