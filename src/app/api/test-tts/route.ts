import { NextRequest, NextResponse } from "next/server";
import https from 'https';

export const dynamic = "force-dynamic";

function httpsRequestString(urlStr: string, options: any, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve(`Status: ${res.statusCode}, Body: ${Buffer.concat(chunks).toString()}`);
      });
    });
    req.on('error', (err) => resolve(`Request Error: ${err.message}`));
    req.on('timeout', () => { req.destroy(); resolve('Timeout Error'); });
    if (payload) req.write(payload);
    req.end();
  });
}

export async function GET(req: NextRequest) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;

  let openaiResult = "No OPENAI_API_KEY found.";
  if (openaiKey) {
    const payload = JSON.stringify({
      model: 'tts-1',
      input: "تست صدا",
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
      timeout: 10000
    };
    openaiResult = await httpsRequestString('https://api.openai.com/v1/audio/speech', options, payload);
  }

  let elevenResult = "No ELEVENLABS_API_KEY found.";
  if (elevenKey) {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; 
    const payload = JSON.stringify({
      text: "تست صدا",
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });
    const options = {
      method: 'POST',
      headers: {
        'xi-api-key': elevenKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };
    elevenResult = await httpsRequestString(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, options, payload);
  }

  return NextResponse.json({
    openai_test: openaiResult.substring(0, 500),
    elevenlabs_test: elevenResult.substring(0, 500)
  });
}
