import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Fetching legacy USDT trades...");
  const { data, error } = await supabase.from('paper_trades').select('*').like('symbol', '%USDT%');
  if (error) {
    console.error(error);
    process.exit(1);
  }
  
  if (!data || data.length === 0) {
    console.log("No legacy USDT trades found.");
    return;
  }
  
  for (const trade of data) {
    // BTC/USDT -> BTC/USDC:USDC
    const newSymbol = trade.symbol.replace('/USDT', '/USDC:USDC');
    const { error: updateError } = await supabase.from('paper_trades').update({ symbol: newSymbol }).eq('id', trade.id);
    if (updateError) {
      console.error(`Failed to update ${trade.id}:`, updateError);
    } else {
      console.log(`Updated trade ${trade.id}: ${trade.symbol} -> ${newSymbol}`);
    }
  }
  console.log("Migration complete.");
}
main();
