import { createActor } from "xstate";
import { ctoMachine } from "./cto-machine";
import { createCTOPullRequest } from "./github-pr";
import { sendTelegramMessage } from "@/lib/telegram";
import { generateAIResponse } from "@/lib/ai";
import { getProject, getTypeErrors } from "./ast-surgeon";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

interface FileEdit {
  path: string;
  content: string;
}

async function planAndDraftFiles(request: string, chatId: string): Promise<FileEdit[]> {
  // Ask Gemini to produce a JSON plan of files to create/modify
  const planPrompt = [
    {
      role: "user" as const,
      content: `You are a senior TypeScript/Next.js engineer working on the Ultron project.
The user wants: "${request}"

Reply ONLY with a valid JSON array (no markdown, no explanation) in this exact shape:
[
  { "path": "src/...", "content": "...full file content..." }
]

Rules:
- Use Next.js 14 App Router conventions.
- No "any" types.
- Tailwind CSS for styling.
- Strict TypeScript.
- Full file content, never truncate.`
    }
  ];

  const raw = await generateAIResponse(planPrompt, false, false, "dev");

  // Extract JSON from the response
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("AI did not return a valid JSON file plan.");

  return JSON.parse(jsonMatch[0]) as FileEdit[];
}

async function typeCheckFiles(files: FileEdit[]): Promise<string[]> {
  // Write files temporarily and check
  for (const file of files) {
    const absPath = path.join(ROOT, file.path);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, file.content, "utf-8");
  }
  const project = getProject();
  return getTypeErrors(project);
}

async function selfHeal(files: FileEdit[], errors: string[], chatId: string): Promise<FileEdit[]> {
  const errorSummary = errors.slice(0, 5).join("\n");
  const healPrompt = [
    {
      role: "user" as const,
      content: `You are fixing TypeScript errors in the Ultron project.

ERRORS:
${errorSummary}

CURRENT FILES:
${files.map(f => `// FILE: ${f.path}\n${f.content}`).join("\n\n---\n\n")}

Reply ONLY with the corrected JSON array (same shape as before). Fix ALL errors.`
    }
  ];

  const raw = await generateAIResponse(healPrompt, false, false, "dev");
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Self-heal did not produce a valid JSON response.");
  return JSON.parse(jsonMatch[0]) as FileEdit[];
}

export async function startCtoWorkflow(request: string, chatId: string): Promise<string> {
  await sendTelegramMessage(chatId, "?? [CTO Machine] ?? ??? ????? ????????...");

  const actor = createActor(ctoMachine, {
    input: { chatId, request, files: [], typeErrors: [], prUrl: "", iteration: 0, error: "" },
  });
  actor.start();

  try {
    // Step 1: Draft files
    let files = await planAndDraftFiles(request, chatId);
    actor.send({ type: "FILES_READY", files });

    // Step 2: Type-check loop (max 3 iterations)
    let iteration = 0;
    while (iteration < 3) {
      const errors = await typeCheckFiles(files);
      if (errors.length === 0) {
        actor.send({ type: "TYPE_CHECK_PASS" });
        break;
      }

      actor.send({ type: "TYPE_CHECK_FAIL", errors });

      if (iteration >= 2) {
        return "? [CTO] ??? ?? ? ???? ???????? ??????? TypeScript ?? ??? ???. ????? ????? ?? ??????? ???????.";
      }

      files = await selfHeal(files, errors, chatId);
      actor.send({ type: "FILES_READY", files });
      iteration++;
    }

    // Step 3: Create PR
    const branchName = `cto/task-${Date.now()}`;
    const prUrl = await createCTOPullRequest({
      branchName,
      title: `[CTO] ${request.slice(0, 72)}`,
      body: `## تغییرات جدید\n${request}\n\n## فایل‌های تغییریافته\n${files.map(f => `- \`${f.path}\``).join("\n")}\n\n> این PR توسط CTO Machine به صورت خودکار ایجاد شد. لطفا قبل از Merge بررسی بفرمایید.`,
      files,
      commitMessage: `feat(cto): ${request.slice(0, 60)}`,
    });

    actor.send({ type: "PR_DONE", prUrl });
    return `✅ Pull Request آماده‌ی بررسی شماست:\n${prUrl}`;
  } catch (err: any) {
    actor.send({ type: "ERROR", message: err.message });
    return `🆘 [CTO] خطا: ${err.message}`;
  } finally {
    actor.stop();
  }
}

// Backward-compat alias for QStash worker at /api/worker/cto
export async function processCtoStep(taskId: string): Promise<void> {
  console.log(`[CTO Orchestrator] processCtoStep called with taskId: ${taskId}. XState machine handles lifecycle.`);
}
