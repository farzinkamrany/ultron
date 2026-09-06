import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(process.cwd(), '.env.local') });
import { supabase } from '../src/lib/supabase';

async function fetchTrade() {
  const { data, error } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('status', 'OPEN');
    
  if (error) {
    console.error("DB Error:", error);
    return;
  }
  
  if (!data || data.length === 0) {
    console.log("NO_OPEN_TRADES");
    return;
  }
  
  console.log(JSON.stringify(data[0], null, 2));
}

fetchTrade();
