import { runGenesisEpoch } from '../src/lib/cto/genesis';

async function main() {
  try {
    await runGenesisEpoch();
    console.log("✅ Genesis Epoch finished successfully.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Genesis Epoch failed:", error);
    process.exit(1);
  }
}

main();
