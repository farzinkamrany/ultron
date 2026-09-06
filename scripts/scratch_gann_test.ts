import { calculateGannSquareOf9 } from '../src/lib/trading/gann';

const entry = 80139.5;
const tp = 80641.07114677412;
const sl = 79481.63480451383;

const { supports, resistances } = calculateGannSquareOf9(entry);

console.log("Entry Price:", entry);
console.log("Gann Supports (Closest):", supports.filter(s => s < entry).sort((a,b)=>b-a).slice(0,3));
console.log("Gann Resistances (Closest):", resistances.filter(r => r > entry).sort((a,b)=>a-b).slice(0,3));

const risk = entry - sl;
const reward = tp - entry;
console.log("\nActual Trade Logic:");
console.log(`Risk: $${risk.toFixed(2)}`);
console.log(`Reward: $${reward.toFixed(2)}`);
console.log(`R:R Ratio: 1:${(reward / risk).toFixed(2)}`);
