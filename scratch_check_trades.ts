import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in env.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOpenTrades() {
  const { data: openTrades, error } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', 'OPEN');
    
  if (error) {
    console.error("Error fetching trades:", error.message);
    return;
  }
  
  if (!openTrades || openTrades.length === 0) {
    console.log("No open trades found in database.");
  } else {
    console.log(`Found ${openTrades.length} open trade(s):`);
    console.table(openTrades.map(t => ({
      id: t.id,
      symbol: t.symbol,
      type: t.position_type,
      entry: t.entry_price,
      tp: t.take_profit,
      sl: t.stop_loss,
      date: t.created_at
    })));
  }
}

checkOpenTrades();
