import { fetchWithRotation } from "@/utils/ai-fetcher";
import { ULTRON_TOOLS } from "@/lib/ai-tools";

export type AgentRole = "RESEARCHER" | "DEVELOPER" | "REVIEWER";

const AGENT_PROMPTS: Record<AgentRole, string> = {
  RESEARCHER: `You are the Lead Researcher AI. Your job is to gather information, analyze requirements, and provide a detailed factual report. 
Do not write production code. Focus on architectural research, summarizing APIs, or finding constraints. Be highly analytical.`,
  
  DEVELOPER: `You are the Lead Developer AI. Your job is to take requirements or research and write robust, production-ready code. 
Focus entirely on technical implementation, error handling, and efficiency. You have access to tools to read and write code to the repository. Use them if necessary. Only output code, technical explanations, or tool calls.`,
  
  REVIEWER: `You are the QA & Security Reviewer AI. Your job is to review the output of the Developer. 
Look for security flaws, edge cases, performance issues, and logical bugs. You MUST provide a final verdict at the very end of your response exactly as either "VERDICT: PASS" or "VERDICT: FAIL" along with reasons.`
};

/**
 * Executes a task using a specialized sub-agent, supporting tool calls for DEVELOPER.
 */
export async function executeAgentTask(role: AgentRole, taskDescription: string, tryPro: boolean = true): Promise<string> {
  const systemInstruction = AGENT_PROMPTS[role];
  
  // Assign tools based on role
  let tools: any[] | undefined = undefined;
  if (role === "DEVELOPER") {
    tools = ULTRON_TOOLS;
  } else if (role === "RESEARCHER") {
    // Enable Google Search Grounding for Researcher to fetch live internet data
    tools = [{ googleSearch: {} }];
  }
  
  const contents: any[] = [{
    role: "user",
    parts: [{ text: taskDescription }]
  }];

  const MAX_ITERATIONS = role === "DEVELOPER" ? 15 : 1; // Allow tool loops for dev

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      ...(tools ? { tools } : {}),
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    });

    try {
      const responseJson = await fetchWithRotation(payload, false, tryPro);
      const candidate = responseJson?.candidates?.[0];
      
      if (!candidate) {
        throw new Error("No candidates returned from AI model");
      }

      const parts: any[] = candidate.content?.parts ?? [];
      const functionCallParts = parts.filter((p: any) => p.functionCall);
      const textPart = parts.find((p: any) => p.text);

      if (functionCallParts.length > 0) {
        contents.push(candidate.content);
        
        const functionResponses: any[] = [];
        for (const fcPart of functionCallParts) {
          let { name, args } = fcPart.functionCall;
          if (typeof args === "string") {
            try { args = JSON.parse(args); } catch (e) {}
          }

          console.log(`[Agent:${role}] Executing tool: ${name}`, args);
          let functionOutput = "";
          
          try {
            if (name === "read_source_code") {
              const { getFileContent } = await import("@/services/github");
              functionOutput = JSON.stringify({ status: "success", content: await getFileContent(args.filePath) });
            } else if (name === "search_codebase") {
              const { searchCodebase } = await import("@/services/github");
              functionOutput = JSON.stringify({ status: "success", content: await searchCodebase(args.query) });
            } else if (name === "write_and_propose_code") {
              const { executeWriteAndProposeCode } = await import("@/lib/ai-tools");
              functionOutput = await executeWriteAndProposeCode(args.filePath, args.content, args.description);
            } else {
              functionOutput = JSON.stringify({ status: "error", details: `Function '${name}' is not supported by this agent.` });
            }
          } catch (err: any) {
            functionOutput = JSON.stringify({ status: "error", details: err.message });
          }

          functionResponses.push({
            functionResponse: { name, response: { result: functionOutput } }
          });
        }

        contents.push({ role: "user", parts: functionResponses });
        continue;
      }

      if (textPart?.text) {
        return textPart.text;
      }
      
      throw new Error("No text or tool call from agent.");
    } catch (error: any) {
      console.error(`[Agent:${role}] Error:`, error.message);
      return `[Agent:${role}] failed to execute task: ${error.message}`;
    }
  }

  return `[Agent:${role}] Error: Max tool iterations reached.`;
}
