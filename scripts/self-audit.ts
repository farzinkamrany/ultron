#!/usr/bin/env npx tsx
/**
 * Ultron Self-Evolution Audit Script
 * Runs in GitHub Actions nightly.
 * Checks for TypeScript errors, outdated deps, and Supabase error patterns.
 * If issues found, creates a PR via GitHub API.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.cwd();
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const REPO = process.env.GITHUB_REPOSITORY || "farzinkamrany/ultron";
const BASE_URL = `https://api.github.com/repos/${REPO}`;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ghFetch(endpoint: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub ${res.status}: ${err}`);
  }
  return res.json();
}

async function sendTelegram(msg: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: "HTML" }),
  }).catch(console.error);
}

async function createPR(branch: string, title: string, body: string, files: { path: string; content: string }[]) {
  const masterRef: any = await ghFetch("/git/ref/heads/master");
  const sha = masterRef.object.sha;

  await ghFetch("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha });

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, "/").replace(/^\//, "");
    let existingSha: string | undefined;
    try {
      const existing: any = await ghFetch(`/contents/${normalizedPath}?ref=${branch}`);
      existingSha = existing.sha;
    } catch (_) {}

    await ghFetch(`/contents/${normalizedPath}`, "PUT", {
      message: `fix(self-evolution): ${title}`,
      content: Buffer.from(file.content).toString("base64"),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    });
  }

  const pr: any = await ghFetch("/pulls", "POST", {
    title: `[Self-Evolution] ${title}`,
    body,
    head: branch,
    base: "master",
  });
  return pr.html_url as string;
}

// ─── Audit 1: TypeScript Errors ─────────────────────────────────────────────

function runTypeCheck(): string[] {
  try {
    execSync("npx tsc --noEmit", { cwd: ROOT, stdio: "pipe" });
    return [];
  } catch (e: any) {
    const output: string = e.stdout?.toString() || e.stderr?.toString() || "";
    return output.split("\n").filter(Boolean).slice(0, 20);
  }
}

// ─── Audit 2: Outdated Dependencies ─────────────────────────────────────────

interface OutdatedPkg {
  current: string;
  wanted: string;
  latest: string;
}

function runDependencyCheck(): Record<string, OutdatedPkg> {
  try {
    const out = execSync("npm outdated --json", { cwd: ROOT, stdio: "pipe" });
    return JSON.parse(out.toString());
  } catch (e: any) {
    // npm outdated exits with code 1 when there are outdated packages
    try { return JSON.parse(e.stdout?.toString() || "{}"); } catch { return {}; }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🤖 [Self-Evolution] Starting audit...");
  const timestamp = new Date().toISOString().slice(0, 10);
  const issues: string[] = [];
  const prFiles: { path: string; content: string }[] = [];

  // --- Audit 1: TypeScript ---
  console.log("⚙️  Running TypeScript check...");
  const tsErrors = runTypeCheck();
  if (tsErrors.length > 0) {
    issues.push(`🔴 ${tsErrors.length} TypeScript error(s) found.`);
    console.log("TypeScript Errors:\n", tsErrors.join("\n"));
  } else {
    console.log("✅ TypeScript: No errors.");
  }

  // --- Audit 2: Outdated Dependencies ---
  console.log("📦 Checking outdated dependencies...");
  const outdated = runDependencyCheck();
  const outdatedList = Object.entries(outdated)
    .filter(([, v]) => v.current !== v.latest)
    .map(([name, v]) => `${name}: ${v.current} → ${v.latest}`);

  if (outdatedList.length > 0) {
    issues.push(`📦 ${outdatedList.length} outdated package(s):\n${outdatedList.slice(0, 5).join("\n")}`);
  } else {
    console.log("✅ Dependencies: All up to date.");
  }

  // --- Report ---
  if (issues.length === 0) {
    console.log("🏆 [Self-Evolution] All audits passed. No action needed.");
    await sendTelegram("🏆 <b>[Self-Evolution] شبانه‌روزی گزارش اجرا شد:</b>\n\n✅ TypeScript بدون خطا\n✅ وابستگی‌ها به‌روز\n\nهیچ اقدامی نیاز نیست.");
    return;
  }

  // --- Create PR with audit report ---
  const branch = `self-evolution/${timestamp}`;
  const reportContent = `# Self-Evolution Audit Report — ${timestamp}\n\n## مشکلات یافت‌شده\n\n${issues.join("\n\n")}\n\n---\n\n> این گزارش توسط Ultron Self-Evolution Agent به صورت خودکار تولید شده است.\n> پس از بررسی، دستورالعمل‌های لازم را از طریق تلگرام به ربات بدهید.`;

  // Write audit report as a markdown file in the PR
  prFiles.push({
    path: `docs/audit-reports/${timestamp}.md`,
    content: reportContent,
  });

  try {
    const prUrl = await createPR(
      branch,
      `Audit Report ${timestamp}`,
      reportContent,
      prFiles
    );
    const telegramMsg = `🔍 <b>[Self-Evolution] گزارش شبانه‌روزی آماده است!</b>\n\n${issues.join("\n")}\n\n<a href="${prUrl}">👉 مشاهده‌ی گزارش در GitHub</a>`;
    await sendTelegram(telegramMsg);
    console.log(`✅ PR created: ${prUrl}`);
  } catch (err: any) {
    console.error("Failed to create PR:", err.message);
    await sendTelegram(`⚠️ [Self-Evolution] خطا در ساخت گزارش: ${err.message}`);
  }
}

main().catch(console.error);
