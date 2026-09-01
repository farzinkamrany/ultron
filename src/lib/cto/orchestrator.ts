import { executeAgentTask } from "./agents";
import { fetchWithRotation } from "@/utils/ai-fetcher";

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

export async function executeCtoWorkflow(userPrompt: string, sendUpdate: (msg: string) => Promise<void>): Promise<string> {
  await sendUpdate("🧠 [CTO] Analyzing task and formulating execution plan...");
  
  // 1. Formulate Plan
  const planPayload = JSON.stringify({
    system_instruction: { parts: [{ text: CTO_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
  });

  let plan;
  try {
    const res = await fetchWithRotation(planPayload, false, true);
    const text = res?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;
    if (!text) throw new Error("Empty plan response");
    plan = JSON.parse(text);
  } catch (error: any) {
    console.error("[CTO] Planning Error:", error);
    return `❌ CTO Orchestrator failed to parse the task: ${error.message}`;
  }

  // 2. Execute Researcher
  await sendUpdate(`🔍 [CTO -> RESEARCHER] Delegating research task:\n"${plan.research_task.substring(0, 50)}..."`);
  const researchOutput = await executeAgentTask("RESEARCHER", plan.research_task);

  // 3 & 4. Execute Developer with Reviewer Loop
  let devOutput = "";
  let reviewOutput = "";
  let currentDevTask = `${plan.develop_task}\n\n[CONTEXT FROM RESEARCHER]:\n${researchOutput}`;
  
  const MAX_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await sendUpdate(`💻 [CTO -> DEVELOPER] Attempt ${attempt}/${MAX_RETRIES}: Writing code...`);
    devOutput = await executeAgentTask("DEVELOPER", currentDevTask);

    await sendUpdate(`🛡️ [CTO -> REVIEWER] Attempt ${attempt}/${MAX_RETRIES}: Submitting for QA review...`);
    const reviewTask = `${plan.review_task}\n\n[CODE FROM DEVELOPER]:\n${devOutput}`;
    reviewOutput = await executeAgentTask("REVIEWER", reviewTask);

    if (reviewOutput.includes("VERDICT: PASS")) {
      await sendUpdate(`✅ [REVIEWER] Code passed QA!`);
      break;
    } else {
      await sendUpdate(`❌ [REVIEWER] Code rejected. Sending back to Developer...`);
      if (attempt < MAX_RETRIES) {
        currentDevTask += `\n\n[REVIEWER FEEDBACK - ATTEMPT ${attempt} FAILED. PLEASE FIX]:\n${reviewOutput}`;
      }
    }
  }

  // 5. Compile Final Summary
  await sendUpdate("✅ [CTO] Aggregating results into final executive report...");
  
  const finalSummaryPrompt = `You are ULTRON-CTO. Synthesize the findings of your sub-agents into a final, highly readable Executive Summary for the user.
Original Task: ${userPrompt}
Reviewer Verdict: ${reviewOutput}

Include snippets of the Developer's code if it passed review. Use beautiful markdown formatting.`;

  const summaryPayload = JSON.stringify({
    system_instruction: { parts: [{ text: "You are ULTRON-CTO." }] },
    contents: [{ role: "user", parts: [{ text: finalSummaryPrompt }] }]
  });

  try {
    const res = await fetchWithRotation(summaryPayload, false, true);
    return res?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || "Summary compilation failed.";
  } catch (error: any) {
    return `❌ Final compilation failed: ${error.message}\n\n[Reviewer Output]:\n${reviewOutput}`;
  }
}
