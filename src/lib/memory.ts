import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { supabase } from "./supabase";

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set");

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`;

  const payload = JSON.stringify({
    model: "models/embedding-001",
    content: {
      parts: [{ text }]
    }
  });

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
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Embedding API Error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          const embedding = json.embedding?.values;
          if (!embedding) throw new Error("No embedding returned");
          resolve(embedding);
        } catch (e) {
          reject(e);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(15000, () => { request.destroy(); reject(new Error("Timeout")); });
    request.write(payload);
    request.end();
  });
}

export async function searchMemories(query: string, match_threshold = 0.7, match_count = 5) {
  const query_embedding = await generateEmbedding(query);
  
  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding,
    match_threshold,
    match_count
  });

  if (error) {
    console.error("Supabase vector search error:", error);
    return [];
  }
  return data || [];
}

export async function storeMemory(content: string, metadata: any = {}) {
  const embedding = await generateEmbedding(content);
  
  const { error } = await supabase
    .from("memory_embeddings")
    .insert([{ content, metadata, embedding }]);

  if (error) {
    console.error("Failed to store memory:", error);
    throw error;
  }
  return true;
}
