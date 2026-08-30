const url = 'https://ultron-assistant-iota.vercel.app/api/location/track';

async function testEndpoint() {
  console.log("Pinging Vercel endpoint:", url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        _type: 'location',
        lat: 35.6892,
        lon: 51.3890,
        acc: 10,
        batt: 95,
        tst: Math.floor(Date.now() / 1000)
      })
    });
    const status = res.status;
    const text = await res.text();
    console.log(`HTTP ${status}: ${text}`);
  } catch (e) {
    console.error("Fetch failed:", e.message);
  }
}

testEndpoint();
