const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8');
const key = env.match(/GOOGLE_GENERATIVE_AI_API_KEY=(.+)/)?.[1]?.trim();

const { ProxyAgent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:10808'));

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
  .then(r => r.json())
  .then(d => {
    if (d.error) { console.log('API Error:', d.error.message); return; }
    d.models?.forEach(m => console.log(m.name, '-', m.displayName));
  })
  .catch(e => console.log('fetch failed:', e.message));
