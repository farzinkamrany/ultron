const fs = require('fs');
const { ProxyAgent, setGlobalDispatcher } = require('undici');
setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:10808'));

const env = fs.readFileSync('.env.local', 'utf-8');
const pat = env.match(/GITHUB_PAT=(.+)/)?.[1]?.trim();
const owner = env.match(/GITHUB_OWNER=(.+)/)?.[1]?.trim();
const repo = env.match(/GITHUB_REPO=(.+)/)?.[1]?.trim();

console.log(`Testing: owner=${owner}, repo=${repo}`);

async function test() {
  // 1. Check PAT identity
  const user = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }).then(r => r.json());
  console.log('✅ PAT Identity:', user.login, '| Scopes work:', !user.message);
  if (user.message) { console.error('❌ PAT Error:', user.message); return; }

  // 2. Check repo access
  const repoData = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }).then(r => r.json());
  
  if (repoData.message) {
    console.error('❌ Repo access error:', repoData.message);
  } else {
    console.log('✅ Repo access OK:', repoData.full_name);
    console.log('   Default branch:', repoData.default_branch);
    console.log('   Private:', repoData.private);
    console.log('   Permissions:', JSON.stringify(repoData.permissions));
  }
}

test().catch(e => console.error('Fatal:', e.message));
