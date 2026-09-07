const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://jvcstdzftnjqfrmbnwap.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp2Y3N0ZHpmdG5qcWZybWJud2FwIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTYzODM3OTcsImV4cCI6MjAxMTk1OTc5N30.7QE_xhfCR7A7pC0_K7PjCLlTJZaZ0RxKbQNMKEZc1rQ'
);

(async () => {
  try {
    const { data, error } = await supabase
      .from('paper_trades')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('❌ Error:', error.message);
      return;
    }
    
    console.log('\n📊 آخرین 10 ترید:\n');
    if (data && data.length > 0) {
      data.forEach((trade, i) => {
        const date = new Date(trade.created_at).toLocaleString('fa-IR');
        console.log(`${i + 1}. ${trade.symbol} | ${trade.action} | Entry: $${trade.entry_price?.toFixed(2)} | Status: ${trade.status} | ${date}`);
      });
      console.log(`\n✅ تعداد کل: ${data.length}`);
    } else {
      console.log('❌ هیچ ترید موجود نیست');
    }
  } catch (err) {
    console.error('Exception:', err.message);
  }
})();
