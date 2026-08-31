import * as googleTTS from 'google-tts-api';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

function httpsRequestBuffer(urlStr: string, options: any, payload: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP Error ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Generates Farsi speech.
 * Uses OpenAI TTS (tts-1) if OPENAI_API_KEY is set (Best for Farsi).
 * Falls back to ElevenLabs if ELEVENLABS_API_KEY is set.
 * Falls back to Google Translate TTS (free) if no key is found.
 */
export async function generateFarsiSpeech(text: string): Promise<Buffer> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  if (openaiKey) {
    try {
      const payload = JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: 'onyx', // Professional male voice with excellent Farsi pronunciation
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

      return await httpsRequestBuffer('https://api.openai.com/v1/audio/speech', options, payload);
    } catch (e) {
      console.error("[TTS] OpenAI failed, falling back...", e);
    }
  }

  if (elevenKey) {
    try {
      // Use Rachel (or any preferred female voice ID)
      const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; 
      const payload = JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        }
      });

      const options = {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        agent: agent,
        timeout: 30000
      };

      return await httpsRequestBuffer(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, options, payload);
    } catch (e) {
      console.error("[TTS] ElevenLabs failed, falling back to Google TTS", e);
    }
  }

  // Fallback to Google TTS
  const results = await googleTTS.getAllAudioBase64(text, {
    lang: 'fa',
    slow: false,
    host: 'https://translate.google.com',
  });

  const buffers = results.map((result) => Buffer.from(result.base64, 'base64'));
  return Buffer.concat(buffers);
}
