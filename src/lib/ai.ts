import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ULTRON_SYSTEM_PROMPT } from "./prompt";
import { searchMemories } from "./memory";

export async function generateAIResponse(messages: { role: string, content: string }[], stream = false): Promise<any> {
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

  const { fetchWithRotation } = await import("@/utils/ai-fetcher");
  return fetchWithRotation(payload, stream, true);
}
