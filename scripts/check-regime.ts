import { detectMarketRegime, calculateDynamicKelly } from '../src/lib/trading/risk';

async function main() {
  console.log("Checking live ATR regime for BTC/USDT...");
  const regime = await detectMarketRegime('BTC/USDT');
  const risk = await calculateDynamicKelly('BTC/USDT');
  console.log("Regime:", regime);
  console.log("Risk %:", (risk * 100).toFixed(1) + "%");
  console.log("Mode:", regime === 'CALM' ? "🟢 CALM — بازار آروم، ریسک تهاجمی" : "🔴 WILD — بازار نوسانی، ریسک دفاعی");
}

main().catch(console.error);
