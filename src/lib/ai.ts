import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ULTRON_SYSTEM_PROMPT } from "./prompt";
import { searchMemories } from "./memory";

export async function generateAIResponse(messages: {role: string, content: string}[], stream = false): Promise<any> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set in .env.local");

  const contents = messages
    .filter(m => m.content && m.content.trim())
    .map(msg => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

  while (contents.length > 0 && contents[0].role === "model") {
    contents.shift();
  }
  
  if (contents.length === 0) throw new Error("No user messages provided");

  // RAG: Retrieve context from deep memory based on the latest user message
  const latestUserMsg = contents.slice().reverse().find(m => m.role === "user")?.parts[0]?.text;
  let memoryContext = "";
  if (latestUserMsg) {
    try {
      const memories = await searchMemories(latestUserMsg);
      if (memories && memories.length > 0) {
        memoryContext = "\n\n[SYSTEM DIRECTIVE: RECALL PAST MEMORIES]\nBased on the user's query, here are relevant past events/decisions from your long-term vector memory. Use them to answer if applicable:\n" 
          + memories.map((m: any) => `- ${m.content} (Match: ${(m.similarity * 100).toFixed(1)}%)`).join("\n");
      }
    } catch (e) {
      console.error("Memory retrieval error:", e);
    }
  }

  const payload = JSON.stringify({
    system_instruction: { parts: [{ text: ULTRON_SYSTEM_PROMPT + memoryContext }] },
    contents,
    generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
  });

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const model = "gemini-3.6-flash";
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
        res.on("end", () => reject(new Error(`API Error ${res.statusCode}: ${errData}`)));
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
    request.setTimeout(30000, () => { request.destroy(); reject(new Error("Request timeout")); });
    request.write(payload);
    request.end();
  });
}
