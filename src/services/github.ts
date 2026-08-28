export async function getGitHubConfig() {
  const pat = process.env.GITHUB_PAT;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!pat || !owner || !repo) {
    throw new Error("GitHub credentials (GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO) are not configured.");
  }
  return { pat, owner, repo };
}

async function githubFetch(endpoint: string, options: RequestInit = {}) {
  const { pat } = await getGitHubConfig();
  const url = `https://api.github.com${endpoint}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${pat}`,
    "Accept": "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.headers as Record<string, string>),
  };

  // GitHub API requires Content-Type for any request with a body
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API Error (${response.status}): ${errorText}`);
  }
  return response.json();
}

/**
 * Reads a file from the repository's main branch.
 */
export async function getFileContent(filePath: string): Promise<string> {
  const { owner, repo } = await getGitHubConfig();
  try {
    const data = await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`);
    if (data.type !== "file") {
      throw new Error(`${filePath} is not a file.`);
    }
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (error: any) {
    if (error.message.includes("404")) {
      return `File ${filePath} does not exist yet.`;
    }
    throw error;
  }
}

/**
 * Creates a new branch, commits the code, and opens a Pull Request.
 */
export async function writeAndProposeCode(filePath: string, content: string, description: string): Promise<string> {
  const { owner, repo } = await getGitHubConfig();
  const branchName = `ultron-update-${Date.now()}`;
  const commitMessage = `Ultron Auto-Commit: Update ${filePath}\n\n${description}`;

  // 1. Get the repo's actual default branch (could be 'main' or 'master')
  const repoData = await githubFetch(`/repos/${owner}/${repo}`);
  const baseBranch = repoData.default_branch || 'main';

  // 2. Get SHA of base branch
  const mainRef = await githubFetch(`/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`);
  const mainSha = mainRef.object.sha;

  // 3. Create new branch
  await githubFetch(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: mainSha,
    }),
  });

  // 3. Check if file exists to get its SHA (required for updating)
  let fileSha;
  try {
    const existingFile = await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}?ref=${branchName}`);
    fileSha = existingFile.sha;
  } catch (e: any) {
    // File doesn't exist, which is fine for creation.
  }

  // 4. Create or update the file on the new branch
  await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(content).toString("base64"),
      branch: branchName,
      ...(fileSha && { sha: fileSha }), // Only include sha if we are updating
    }),
  });

  // 5. Create a Pull Request
  const pr = await githubFetch(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Ultron Code Proposal: Update ${filePath}`,
      body: `**Ultron Autonomous Modification**\n\n${description}\n\nReview this code before merging.`,
      head: branchName,
      base: "main",
    }),
  });

  return `Pull Request successfully created! URL: ${pr.html_url}`;
}
