// Test GitHub PAT permissions via Next.js app (uses global proxy)
// Hit: GET http://localhost:3000/api/admin/test-github
import { NextResponse } from "next/server";

export async function GET() {
  const pat = process.env.GITHUB_PAT;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  const headers = {
    "Authorization": `Bearer ${pat}`,
    "Accept": "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // 1. Test PAT identity
  const userRes = await fetch("https://api.github.com/user", { headers });
  const user = await userRes.json();
  if (!userRes.ok) {
    return NextResponse.json({ step: "auth", error: user.message, hint: "PAT is invalid or expired" }, { status: 400 });
  }

  // 2. Test repo access
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  const repoData = await repoRes.json();
  if (!repoRes.ok) {
    return NextResponse.json({ step: "repo", error: repoData.message, hint: "PAT lacks 'repo' permission or repo doesn't exist" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    user: user.login,
    repo: repoData.full_name,
    default_branch: repoData.default_branch,
    permissions: repoData.permissions,
    env_vars: { pat: !!pat, owner, repo },
  });
}
