import { ULTRON_SYSTEM_PROMPT } from "./prompt";
import { searchMemories } from "./memory";
import { ULTRON_TOOLS } from "./ai-tools";
import { getFileContent, writeAndProposeCode } from "@/services/github";

export async function generateAIResponse(messages: { role: string, content: string }[], stream = false): Promise<any> {
  const contents: any[] = messages
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

  const { fetchWithRotation } = await import("@/utils/ai-fetcher");

  // Tool Execution Loop (max 5 iterations to prevent infinite loops)
  const MAX_ITERATIONS = 5;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: ULTRON_SYSTEM_PROMPT + memoryContext }] },
      contents,
      tools: ULTRON_TOOLS,
      generationConfig: { temperature: 0.8, maxOutputTokens: 4000 },
    });

    const responseJson = await fetchWithRotation(payload, false, true);

    const candidate = responseJson?.candidates?.[0];
    if (!candidate) {
      throw new Error("No candidates returned from AI model");
    }

    const finishReason = candidate.finishReason;
    const parts: any[] = candidate.content?.parts ?? [];

    // Scan ALL parts for function calls (Gemini can return multiple in one response)
    const functionCallParts = parts.filter((p: any) => p.functionCall);
    const textPart = parts.find((p: any) => p.text);

    if (functionCallParts.length > 0) {
      // Add the model's turn (with all its parts) to the conversation
      contents.push(candidate.content);

      // Execute every function call and collect responses
      const functionResponses: any[] = [];
      for (const fcPart of functionCallParts) {
        const { name, args } = fcPart.functionCall;
        console.log(`[Ultron] Executing function: ${name}`, args);

        let functionOutput = "";
        try {
          if (name === "read_source_code") {
            const code = await getFileContent(args.filePath);
            functionOutput = JSON.stringify({ status: "success", content: code });
          } else if (name === "write_and_propose_code") {
            const prUrl = await writeAndProposeCode(args.filePath, args.content, args.description);
            functionOutput = JSON.stringify({ status: "success", pr_url: prUrl });
          } else {
            functionOutput = JSON.stringify({ status: "error", details: `Function '${name}' is not implemented.` });
          }
        } catch (err: any) {
          // Return error as structured JSON so the LLM understands it and responds gracefully
          // instead of retrying the same tool call
          functionOutput = JSON.stringify({ status: "error", details: err.message });
        }

        console.log(`[Ultron] Function "${name}" output:`, functionOutput.substring(0, 200));
        functionResponses.push({
          functionResponse: {
            name,
            response: { result: functionOutput }
          }
        });
      }

      // Feed all function results back as a single user turn
      contents.push({
        role: "user",
        parts: functionResponses,
      });

      // Continue loop — model will now process the tool results
      continue;
    }

    // No function calls — return the text response
    if (textPart?.text) {
      return textPart.text;
    }

    // Edge case: model stopped for a non-obvious reason
    console.warn(`[Ultron] Unexpected finish. reason="${finishReason}", parts=${JSON.stringify(parts)}`);
    return "AI returned an unexpected format. Please try again.";
  }

  return "Error: Reached maximum tool execution iterations without returning text.";
}
