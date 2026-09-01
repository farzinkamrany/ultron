import { executeAgentTask } from "./agents";
import { fetchWithRotation } from "@/utils/ai-fetcher";
import { redis } from "@/lib/redis";
import { sendTelegramMessage } from "@/lib/telegram";
import { searchMemories, storeMemory } from "@/lib/memory";

export type CtoStep = "PLANNING" | "RESEARCHING" | "DEVELOPING" | "REVIEWING" | "SUMMARIZING" | "COMPLETED";

export interface CtoState {
  taskId: string;
  chatId: string;
  userPrompt: string;
  step: CtoStep;
  plan?: {
    research_task: string;
    develop_task: string;
    review_task: string;
  };
  researchOutput?: string;
  devOutput?: string;
  reviewOutput?: string;
  devAttempt: number;
  currentDevTask?: string;
}

const CTO_SYSTEM_PROMPT = `You are ULTRON-CTO, an advanced orchestrator AI.
The user has provided a complex task. Your job is to break it down into exactly 3 sequential sub-tasks that will be assigned to specialized sub-agents:
1. RESEARCHER: Define what needs to be researched or planned.
2. DEVELOPER: Define what code or logic needs to be written based on the research.
3. REVIEWER: Define what needs to be reviewed or verified based on the developer's output.

Output ONLY a valid JSON object with the following structure (no markdown blocks, no other text):
{
  "research_task": "instructions for researcher",
  "develop_task": "instructions for developer",
  "review_task": "instructions for reviewer"
}`;

const MAX_DEV_RETRIES = 2;

/**
 * Triggers the next QStash worker execution
 */
async function triggerNextStep(taskId: string) {
  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    console.warn("⚠️ No QSTASH_TOKEN. Skipping QStash trigger.");
    return;
  }
  
  // App URL resolution
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://ultron.vercel.app');

  try {
    // Delay next step slightly to allow Vercel/LLM limits to reset if needed
    await fetch(`https://qstash.upstash.io/v2/publish/${appUrl}/api/worker/cto`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${qstashToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskId }),
    });
    console.log(`[QStash] Triggered next step for task ${taskId}`);
  } catch (error) {
    console.error("[QStash] Trigger Error:", error);
  }
}

/**
 * Starts a new CTO workflow and pushes it to the QStash background queue.
 */
export async function startCtoWorkflow(userPrompt: string, chatId: string): Promise<string> {
  const taskId = `cto_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const stateKey = `cto_state:${taskId}`;
  
  // RAG: Fetch relevant past memories
  let enrichedPrompt = userPrompt;
  try {
    const memories = await searchMemories(userPrompt, 0.7, 3);
    if (memories && memories.length > 0) {
      enrichedPrompt = `[LONG-TERM MEMORY RAG]
Here is context from past CTO debugging sessions and user preferences that might be highly relevant. Use this knowledge to avoid repeating past mistakes:
${memories.map((m: any) => `- ${m.content}`).join("\n")}

[CURRENT TASK]
${userPrompt}`;
      console.log(`[CTO RAG] Injected ${memories.length} past memories into prompt.`);
    }
  } catch (ragError) {
    console.error("[CTO RAG] Failed to fetch memories, continuing without RAG:", ragError);
  }

  const initialState: CtoState = {
    taskId,
    chatId,
    userPrompt: enrichedPrompt,
    step: "PLANNING",
    devAttempt: 1
  };
  
  await redis.set(stateKey, initialState);
  await triggerNextStep(taskId);
  
  return `CTO Task started in the background (Task ID: \`${taskId}\`).\nI will notify you here as it progresses! 🚀`;
}

/**
 * Executes a single step of the CTO workflow based on the current state.
 */
export async function processCtoStep(taskId: string): Promise<void> {
  const stateKey = `cto_state:${taskId}`;
  const rawState = await redis.get(stateKey);
  
  if (!rawState) {
    console.error(`[CTO Worker] State not found for task ${taskId}`);
    return;
  }
  
  // Handle Upstash Redis JSON parsing
  const state: CtoState = typeof rawState === "string" ? JSON.parse(rawState) : rawState;

  const notify = async (msg: string) => {
    if (state.chatId) {
      // Small delay to ensure order in Telegram
      await new Promise(resolve => setTimeout(resolve, 500));
      await sendTelegramMessage(state.chatId, msg);
    }
    console.log(msg);
  };

  try {
    if (state.step === "PLANNING") {
      await notify("🧠 [CTO] Analyzing task and formulating execution plan...");
      
      const planPayload = JSON.stringify({
        system_instruction: { parts: [{ text: CTO_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: state.userPrompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      });

      const res = await fetchWithRotation(planPayload, false, true);
      const text = res?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
      if (!text) throw new Error("Empty plan response");
      
      state.plan = JSON.parse(text);
      state.step = "RESEARCHING";
      
    } else if (state.step === "RESEARCHING") {
      await notify(`🔍 [CTO -> RESEARCHER] Delegating research task:\n"${state.plan!.research_task.substring(0, 50)}..."`);
      
      const output = await executeAgentTask("RESEARCHER", state.plan!.research_task);
      state.researchOutput = output;
      state.currentDevTask = `${state.plan!.develop_task}\n\n[CONTEXT FROM RESEARCHER]:\n${output}`;
      state.step = "DEVELOPING";
      
    } else if (state.step === "DEVELOPING") {
      await notify(`💻 [CTO -> DEVELOPER] Attempt ${state.devAttempt}/${MAX_DEV_RETRIES}: Writing code...`);
      
      const output = await executeAgentTask("DEVELOPER", state.currentDevTask!);
      state.devOutput = output;
      state.step = "REVIEWING";
      
    } else if (state.step === "REVIEWING") {
      await notify(`🛡️ [CTO -> REVIEWER] Attempt ${state.devAttempt}/${MAX_DEV_RETRIES}: Submitting for QA review...`);
      
      const reviewTask = `${state.plan!.review_task}\n\n[CODE FROM DEVELOPER]:\n${state.devOutput}`;
      const output = await executeAgentTask("REVIEWER", reviewTask);
      state.reviewOutput = output;
      
      if (output.includes("VERDICT: PASS")) {
        await notify(`✅ [REVIEWER] Code passed QA!`);
        state.step = "SUMMARIZING";
      } else {
        await notify(`❌ [REVIEWER] Code rejected.`);
        if (state.devAttempt < MAX_DEV_RETRIES) {
          state.devAttempt += 1;
          state.currentDevTask += `\n\n[REVIEWER FEEDBACK - ATTEMPT ${state.devAttempt - 1} FAILED. PLEASE FIX]:\n${output}`;
          state.step = "DEVELOPING";
          await notify(`🔄 Sending back to Developer (Attempt ${state.devAttempt})...`);
        } else {
          await notify(`⚠️ [REVIEWER] Max retries reached. Moving to summary.`);
          state.step = "SUMMARIZING";
        }
      }
      
    } else if (state.step === "SUMMARIZING") {
      await notify("✅ [CTO] Aggregating results into final executive report...");
      
      const prompt = `You are ULTRON-CTO. Synthesize the findings of your sub-agents into a final, highly readable Executive Summary for the user.
Original Task: ${state.userPrompt}
Reviewer Verdict: ${state.reviewOutput}

Include snippets of the Developer's code if it passed review. Use beautiful markdown formatting.`;

      const payload = JSON.stringify({
        system_instruction: { parts: [{ text: "You are ULTRON-CTO." }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });

      const res = await fetchWithRotation(payload, false, true);
      const text = res?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || "Summary compilation failed.";
      
      await notify(`📋 **[CTO FINAL REPORT]**\n\n${text}`);
      
      // Store RAG Memory for future tasks
      try {
        await storeMemory(`CTO completed task: ${state.userPrompt}\nResolution: ${text.substring(0, 500)}`);
        console.log("[CTO RAG] Successfully stored memory for this task.");
      } catch (e) {
        console.error("[CTO RAG] Failed to store memory:", e);
      }
      
      state.step = "COMPLETED";
    }

    // Save state back to Redis
    await redis.set(stateKey, state);

    // If not completed, trigger next step via QStash
    if (state.step !== "COMPLETED") {
      await triggerNextStep(taskId);
    }
    
  } catch (error: any) {
    console.error(`[CTO Worker] Error at step ${state.step}:`, error);
    await notify(`❌ CTO Error at ${state.step}: ${error.message}`);
    // Do not trigger next step, halt execution.
  }
}
