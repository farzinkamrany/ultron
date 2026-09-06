import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });
import { supabase } from '../src/lib/supabase';

async function checkBalance() {
  console.log("Fetching all paper trades to calculate overall balance...");
  
  const { data: allTrades, error } = await supabase
    .from('paper_trades')
    .select('pnl, status')
    .in('status', ['WON', 'LOST']);

  if (error) {
    console.error("Error fetching trades:", error);
    return;
  }

  const initialCapital = 1000;
  let totalPnl = 0;
  let wins = 0;
  let losses = 0;

  if (allTrades) {
    for (const t of allTrades) {
      totalPnl += (t.pnl || 0);
      if (t.status === 'WON') wins++;
      else if (t.status === 'LOST') losses++;
    }
  }

  const currentBalance = initialCapital + totalPnl;
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  console.log("-----------------------------------------");
  console.log(`Initial Capital : $${initialCapital.toFixed(2)}`);
  console.log(`Net PnL         : $${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`);
  console.log(`Current Balance : $${currentBalance.toFixed(2)}`);
  console.log("-----------------------------------------");
  console.log(`Total Trades    : ${totalTrades}`);
  console.log(`Wins / Losses   : ${wins} / ${losses}`);
  console.log(`All-Time Win%   : ${winRate.toFixed(2)}%`);
  console.log("-----------------------------------------");
}

checkBalance().catch(console.error);
