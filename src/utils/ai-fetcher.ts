import { PRO_MODELS, FLASH_MODELS, getApiKeysPool } from "@/config/ai-models";

class ApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function makeHttpsRequest(model: string, apiKey: string, payload: string, stream: boolean): Promise<any> {
  const action = stream ? "streamGenerateContent" : "generateContent";
  const urlString = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}${stream ? '&alt=sse' : ''}`;
  
  const controller = new AbortController();
  // Vercel limits us to 60s total, so if a model hangs for 15s, rotate immediately.
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(urlString, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: payload,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text();
      throw new ApiError(res.status, errorText);
    }

    if (stream) {
      // Stream parsing if ever needed
      return await res.json();
    } else {
      return await res.json();
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ApiError(408, "Request Timeout");
    }
    throw new ApiError(500, err.message);
  }
}

const PENALTY_BOX: Record<string, number> = {};
const PENALTY_DURATION_MS = 1000 * 60 * 30; // 30 minutes

/**
 * Fetches AI content with automatic fallback for API keys (429/403 errors) 
 * and model degradation (404/503 errors).
 */
export async function fetchWithRotation(payload: string, stream = false, tryPro = true): Promise<any> {
  const keys = getApiKeysPool();
  const modelsToTry = tryPro ? [...PRO_MODELS, ...FLASH_MODELS] : [...FLASH_MODELS];

  let lastError: any = null;
  let requestAttempted = false;

  for (const model of modelsToTry) {
    if (PENALTY_BOX[model] && Date.now() < PENALTY_BOX[model]) {
      console.warn(`[AI Rotation] Skipping model ${model} (In Penalty Box)`);
      continue;
    }

    for (const key of keys) {
      if (PENALTY_BOX[key] && Date.now() < PENALTY_BOX[key]) {
        continue; // silently skip key to avoid log spam
      }

      requestAttempted = true;
      try {
        return await makeHttpsRequest(model, key, payload, stream);
      } catch (err: any) {
        lastError = err;
        const statusCode = err.statusCode || 500;
        const keyHint = key.substring(0, 8) + "...";
        
        console.warn(`[AI Rotation] Model: ${model} | Key: ${keyHint} | Failed with ${statusCode} | Error: ${err.message}`);

        if (statusCode === 429 || statusCode === 403) {
          // Key exhausted or rate-limited. Ban key for 30m.
          PENALTY_BOX[key] = Date.now() + PENALTY_DURATION_MS;
          console.warn(`[AI Rotation] Rotating to next API key...`);
          continue;
        } else if (statusCode === 404 || statusCode === 503 || statusCode === 400 || statusCode === 408) {
          // Model dead/overloaded. Ban model for 30m.
          PENALTY_BOX[model] = Date.now() + PENALTY_DURATION_MS;
          console.warn(`[AI Rotation] Rotating to next AI model...`);
          break;
        } else {
          // Generic server error (500), try next model.
          break;
        }
      }
    }
  }

  // Hail Mary: If everything was in the penalty box, clear it and try the first combo.
  if (!requestAttempted) {
    console.warn("[AI Rotation] All models/keys in penalty box! Clearing box and attempting Hail Mary...");
    for (const k in PENALTY_BOX) delete PENALTY_BOX[k];
    return await makeHttpsRequest(modelsToTry[0], keys[0], payload, stream);
  }

  console.error("[AI Rotation] All models and keys failed.");
  throw lastError || new Error("AI request failed after exhausting all keys and models.");
}
