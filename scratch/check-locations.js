const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLocations() {
  console.log('Checking Supabase for recent location pings...');
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error fetching locations:', error.message);
  } else if (data && data.length > 0) {
    console.log(`✅ Success! Found ${data.length} recent location pings:\n`);
    data.forEach((loc, index) => {
      console.log(`[Ping ${index + 1}] Time: ${loc.recorded_at} | Context: ${loc.context} | Batt: ${loc.battery}%`);
      console.log(`          Lat: ${loc.lat}, Lon: ${loc.lon}\n`);
    });
  } else {
    console.log('⚠️ No location pings found in the database yet.');
  }
}

checkLocations();
