import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLast10Trades() {
  const { data, error } = await supabase
    .from('paper_trades')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error("Error fetching trades:", error);
    return;
  }

  console.log("\n🔍 LAST 10 TRADES IN SUPABASE DATABASE:");
  data.forEach((t: any) => {
    const symbolFormat = t.symbol.padEnd(8, ' ');
    const posType = t.position_type.padEnd(5, ' ');
    const status = t.status.padEnd(6, ' ');
    const entry = t.entry_price ? t.entry_price.toFixed(4) : 'N/A';
    const pnlStr = t.pnl ? (t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`) : 'OPEN';
    const date = new Date(t.created_at).toISOString().split('T')[0];
    
    console.log(`[${date}] ${symbolFormat} | ${posType} | Status: ${status} | Entry: $${entry} | PnL: ${pnlStr}`);
  });
}

checkLast10Trades();
