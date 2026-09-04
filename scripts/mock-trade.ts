import { supabase } from '../src/lib/supabase';

async function main() {
  console.log("Inserting a mock trade to test the Mini-App UI...");
  
  const mockTrade = {
    symbol: 'BTC/USDT',
    position_type: 'LONG',
    entry_price: 64500.0,
    stop_loss: 63000.0,
    take_profit: 69000.0,
    status: 'OPEN',
    rationale: 'Protocol V13.0 Test Signal (Regime: TRENDING | 15m)',
    pnl: 0
  };

  const { error } = await supabase.from('paper_trades').insert([mockTrade]);
  
  if (error) {
    console.error("Failed to insert mock trade:", error);
  } else {
    console.log("✅ Mock trade successfully inserted into Supabase 'paper_trades' table.");
    console.log("The Telegram Mini-App should now display this trade.");
  }
}

main();
