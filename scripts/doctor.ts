import { runSystemDiagnostics } from '../src/lib/diagnostics';
import { loadEnvConfig } from '@next/env';

// Load environment variables manually for a standalone script
const projectDir = process.cwd();
loadEnvConfig(projectDir);

async function main() {
  console.log("🩺 Starting System Diagnostics (Doctor)...");
  try {
    const report = await runSystemDiagnostics();
    console.log("\n=====================");
    console.log(report);
    console.log("=====================\n");
  } catch (error) {
    console.error("Diagnostic Error:", error);
  } finally {
    process.exit(0);
  }
}

main();
