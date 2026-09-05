import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import ccxt from 'ccxt';

async function main() {
  const { supabase } = await import('../src/lib/supabase');
  console.log("Fetching OPEN trades from Supabase...");
  const { data: openTrades, error } = await supabase.from('paper_trades').select('*').eq('status', 'OPEN');
  if (error) {
    console.error("Supabase Error:", error);
    return;
  }
  
  if (!openTrades || openTrades.length === 0) {
    console.log("No OPEN trades found.");
    return;
  }
  
  console.log(`Found ${openTrades.length} open trade(s):`);
  console.log(JSON.stringify(openTrades, null, 2));

  const exchange = new ccxt.hyperliquid({ enableRateLimit: true, options: { defaultType: 'swap' } });
  
  const symbols = [...new Set(openTrades.map(t => t.symbol))];
  const hlSymbols = symbols.map(s => s.includes('/USDT') ? s.replace('/USDT', '/USDC:USDC') : s);
  
  console.log(`\nFetching Hyperliquid tickers for: ${hlSymbols.join(', ')}`);
  try {
    const tickers = await exchange.fetchTickers(hlSymbols);
    for (const sym of hlSymbols) {
      const ticker = tickers[sym];
      if (ticker) {
        console.log(`[OK] Ticker for ${sym} -> Last Price: ${ticker.last}`);
      } else {
        console.log(`[FAIL] No ticker data for ${sym}`);
      }
    }
  } catch (err: any) {
    console.error("CCXT Error fetching tickers:", err.message);
  }
}

main().catch(console.error);
