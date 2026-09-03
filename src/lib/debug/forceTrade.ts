import { supabase } from '@/lib/supabase';

export async function forceInjectTrade() {
  const { data, error } = await supabase
    .from('paper_trades')
    .insert([
      {
        symbol: 'BTC/USDT',
        position_type: 'LONG',
        entry_price: 58420.5,
        stop_loss: 57800.0,
        take_profit: 60200.0,
        status: 'OPEN',
        pnl: 0,
      }
    ]);
  
  if (error) console.error('Injection failed:', error);
  return { data, error };
}
