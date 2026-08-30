const secret = process.env.OWNTRACKS_SECRET;

if (!secret) {
  console.error("Missing OWNTRACKS_SECRET");
  process.exit(1);
}

const basicAuth = `Basic ${Buffer.from(`ultron:${secret}`).toString('base64')}`;

fetch('https://ultron-assistant-iota.vercel.app/api/location/track', {
  method: 'POST',
  headers: {
    'Authorization': basicAuth,
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
})
  .then(res => res.text().then(text => ({ status: res.status, text })))
  .then(console.log)
  .catch(console.error);
