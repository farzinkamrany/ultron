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
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}${stream ? '&alt=sse' : ''}`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    if (!response.ok) {
      const errData = await response.text();
      throw new ApiError(response.status || 500, errData);
    }

    if (stream) {
      return response;
    } else {
      return await response.json();
    }
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, error.message || "Unknown Fetch Error");
  }
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
