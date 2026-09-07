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

async function checkFailedTrades() {
  const { data: trades, error } = await supabase
    .from('paper_trades')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
    
  if (error) {
    console.error("Error fetching trades:", error.message);
    return;
  }
  
  if (!trades || trades.length === 0) {
    console.log("No trades found in database.");
  } else {
    console.log(`Found ${trades.length} recent trade(s):`);
    console.log(JSON.stringify(trades.filter(t => t.status === 'FAILED' || t.status === 'CLOSED'), null, 2));
    
    // Also print out the distribution of statuses
    const statuses = trades.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
    }, {});
    console.log("Status distribution for last 30 trades:", statuses);
  }
}

checkFailedTrades();
