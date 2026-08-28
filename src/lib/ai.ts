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

  // Tool Execution Loop (max 3 iterations to prevent infinite loops)
  const MAX_ITERATIONS = 3;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: ULTRON_SYSTEM_PROMPT + memoryContext }] },
      contents,
      tools: ULTRON_TOOLS,
      generationConfig: { temperature: 0.8, maxOutputTokens: 4000 },
    });

    const responseJson = await fetchWithRotation(payload, false, true); // Function calling rarely works well with raw streams
    
    const candidate = responseJson?.candidates?.[0];
    if (!candidate) {
      throw new Error("No candidates returned from AI model");
    }

    const part = candidate.content?.parts?.[0];

    // If it's a function call
    if (part?.functionCall) {
      const { name, args } = part.functionCall;
      console.log(`[Ultron] Executing function: ${name}`, args);
      
      let functionOutput = "";
      try {
        if (name === "read_source_code") {
          const code = await getFileContent(args.filePath);
          functionOutput = `Content of ${args.filePath}:\n\`\`\`\n${code}\n\`\`\``;
        } else if (name === "write_and_propose_code") {
          const prUrl = await writeAndProposeCode(args.filePath, args.content, args.description);
          functionOutput = `Code successfully proposed. PR URL: ${prUrl}`;
        } else {
          functionOutput = `Error: Function ${name} is not implemented.`;
        }
      } catch (err: any) {
        functionOutput = `Error executing function ${name}: ${err.message}`;
      }

      console.log(`[Ultron] Function output:`, functionOutput);

      // Add the model's function call to contents
      contents.push(candidate.content);
      
      // Add the function response to contents
      contents.push({
        role: "user",
        parts: [{
          functionResponse: {
            name,
            response: { result: functionOutput }
          }
        }]
      });

      // Continue the loop to let the model evaluate the response
      continue;
    }

    // If it's just text
    if (part?.text) {
      return part.text;
    }

    return "AI returned an unknown format.";
  }

  return "Error: Reached maximum tool execution iterations without returning text.";
}
