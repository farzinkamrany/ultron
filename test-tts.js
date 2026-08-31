const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const openaiKey = process.env.OPENAI_API_KEY;
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

const payload = JSON.stringify({
  model: 'tts-1',
  input: 'سلام این یک تست است',
  voice: 'onyx',
  response_format: 'mp3',
});

const options = {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${openaiKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  },
  agent: agent,
  timeout: 30000
};

const req = https.request('https://api.openai.com/v1/audio/speech', options, (res) => {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    if (res.statusCode >= 400) {
      console.error(`HTTP Error ${res.statusCode}: ${Buffer.concat(chunks).toString()}`);
    } else {
      console.log('Success! Buffer length:', Buffer.concat(chunks).length);
    }
  });
});
req.on('error', (err) => console.error('Request Error:', err));
req.write(payload);
req.end();
