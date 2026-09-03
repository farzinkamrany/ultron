const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || "farzinkamrany/ultron";
const BASE_URL = `https://api.github.com/repos/${REPO}`;

async function githubFetch(endpoint: string, method = "GET", body?: unknown) {
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
    throw new Error(`GitHub API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function getMainSHA(): Promise<string> {
  const data: any = await githubFetch("/git/ref/heads/master");
  return data.object.sha;
}

async function createBranch(branchName: string, sha: string): Promise<void> {
  await githubFetch("/git/refs", "POST", { ref: `refs/heads/${branchName}`, sha });
}

async function upsertFile(
  branchName: string,
  filePath: string,
  content: string,
  message: string
): Promise<void> {
  // Normalize path to use forward slashes for GitHub API
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\//, "");

  // Check if file exists to get its SHA for update
  let sha: string | undefined;
  try {
    const existing: any = await githubFetch(`/contents/${normalizedPath}?ref=${branchName}`);
    sha = existing.sha;
  } catch (_) {
    // File doesn't exist yet  that's fine
  }

  await githubFetch(`/contents/${normalizedPath}`, "PUT", {
    message,
    content: Buffer.from(content).toString("base64"),
    branch: branchName,
    ...(sha ? { sha } : {}),
  });
}

async function createPullRequest(
  branchName: string,
  title: string,
  body: string
): Promise<string> {
  const data: any = await githubFetch("/pulls", "POST", {
    title,
    body,
    head: branchName,
    base: "master",
  });
  return data.html_url;
}

export interface CTOPROptions {
  branchName: string;
  title: string;
  body: string;
  files: { path: string; content: string }[];
  commitMessage: string;
}

export async function createCTOPullRequest(options: CTOPROptions): Promise<string> {
  const { branchName, title, body, files, commitMessage } = options;

  const sha = await getMainSHA();
  await createBranch(branchName, sha);

  for (const file of files) {
    await upsertFile(branchName, file.path, file.content, commitMessage);
  }

  const prUrl = await createPullRequest(branchName, title, body);
  return prUrl;
}
