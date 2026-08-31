import * as googleTTS from 'google-tts-api';

/**
 * Generates Farsi speech.
 * Uses OpenAI TTS (tts-1) if OPENAI_API_KEY is set (Best for Farsi).
 * Falls back to ElevenLabs if ELEVENLABS_API_KEY is set.
 * Falls back to Google Translate TTS (free) if no key is found.
 */
export async function generateFarsiSpeech(text: string): Promise<Buffer> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;

  if (openaiKey) {
    try {
      const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      const fetchOptions: any = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: 'onyx', // Professional male voice with excellent Farsi pronunciation
          response_format: 'mp3',
        }),
      };

      if (proxyUrl) {
        const { ProxyAgent } = require('undici');
        fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
      }

      const response = await fetch('https://api.openai.com/v1/audio/speech', fetchOptions);

      if (!response.ok) {
        throw new Error(`OpenAI TTS error: ${await response.text()}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (e) {
      console.error("[TTS] OpenAI failed, falling back...", e);
    }
  }

  if (elevenKey) {
    try {
      // Use Rachel (or any preferred female voice ID)
      const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; 
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2', // Multilingual v2 has amazing Farsi support
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs error: ${await response.text()}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
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
