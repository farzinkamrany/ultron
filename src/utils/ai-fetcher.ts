import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { PRO_MODELS, FLASH_MODELS, getApiKeysPool } from "@/config/ai-models";

class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function makeHttpsRequest(model: string, apiKey: string, payload: string, stream: boolean): Promise<any> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const action = stream ? "streamGenerateContent" : "generateContent";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}${stream ? '&alt=sse' : ''}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(apiUrl);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : {}),
    };

    const request = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errData = "";
        res.on("data", chunk => errData += chunk);
        res.on("end", () => {
          reject(new ApiError(res.statusCode || 500, errData));
        });
        return;
      }

      if (stream) {
        resolve(res);
      } else {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json?.candidates?.[0]?.content?.parts?.[0]?.text || "");
          } catch (e) {
            reject(e);
          }
        });
      }
    });

    request.on("error", reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new ApiError(408, "Request timeout"));
    });
    request.write(payload);
    request.end();
  });
}

/**
 * Fetches AI content with automatic fallback for API keys (429/403 errors) 
 * and model degradation (404/503 errors).
 */
export async function fetchWithRotation(payload: string, stream = false, tryPro = true): Promise<any> {
  const keys = getApiKeysPool();
  const modelsToTry = tryPro ? [...PRO_MODELS, ...FLASH_MODELS] : [...FLASH_MODELS];

  let lastError: any = null;

  for (const model of modelsToTry) {
    for (const key of keys) {
      try {
        return await makeHttpsRequest(model, key, payload, stream);
      } catch (err: any) {
        lastError = err;
        const statusCode = err.statusCode || 500;
        const keyHint = key.substring(0, 8) + "...";
        
        console.warn(`[AI Rotation] Model: ${model} | Key: ${keyHint} | Failed with ${statusCode}`);

        if (statusCode === 429 || statusCode === 403) {
          // Key exhausted or rate-limited. Rotate to the next KEY in the inner loop.
          console.warn(`[AI Rotation] Rotating to next API key...`);
          continue;
        } else if (statusCode === 404 || statusCode === 503 || statusCode === 400 || statusCode === 408) {
          // Model does not exist (404), is overloaded (503), timed out (408), 
          // or does not support the payload structure (400).
          // Break the inner loop to rotate to the next MODEL.
          console.warn(`[AI Rotation] Rotating to next AI model...`);
          break;
        } else {
          // Generic server error (500), try next model.
          break;
        }
      }
    }
  }

  console.error("[AI Rotation] All models and keys failed.");
  throw lastError || new Error("AI request failed after exhausting all keys and models.");
}
