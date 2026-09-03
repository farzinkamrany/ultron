import { supabase } from "./supabase";

export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set");

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`;

  const payload = JSON.stringify({
    model: "models/embedding-001",
    content: {
      parts: [{ text }]
    },
    outputDimensionality: 768
  });

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(30000), // 30s timeout
    });
    if (!response.ok) {
      const errData = await response.text();
      throw new Error(`Embedding API Error ${response.status}: ${errData}`);
    }
    const json = await response.json();
    const embedding = json.embedding?.values;
    if (!embedding) throw new Error("No embedding returned");
    return embedding;
  } catch (error: any) {
    throw error;
  }
}

export async function searchMemories(query: string, match_threshold = 0.7, match_count = 5) {
  const query_embedding = await generateEmbedding(query);
  
  try {
    const timeoutPromise = new Promise<any>((resolve) => 
      setTimeout(() => resolve({ data: null, error: new Error("Supabase Timeout") }), 5000)
    );
    
    const { data, error } = await Promise.race([
      supabase.rpc("match_memories", {
        query_embedding,
        match_threshold,
        match_count
      }),
      timeoutPromise
    ]);

    if (error) {
      console.error("Supabase vector search error:", error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error("Supabase vector search failed:", error);
    return [];
  }
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
