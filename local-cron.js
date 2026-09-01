const http = require('http');

console.log("🚀 Ultron Local Cron Manager Started!");
console.log("⏱️ Interval: Every 3 Hours");

function triggerCron() {
  console.log(`[${new Date().toLocaleTimeString()}] Triggering Autonomous Analyst...`);
  
  const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/cron',
    method: 'GET',
    timeout: 120000 // 2 minutes timeout just in case
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      console.log(`✅ Result (${res.statusCode}):`, data);
    });
  });

  req.on('error', (e) => {
    console.error(`❌ Connection Error: ${e.message}`);
    console.error("   Make sure your Next.js server (npm run dev) is running on port 3000!");
  });
  
  req.on('timeout', () => {
    req.destroy();
    console.error("⏳ Timeout Error: The request took too long.");
  });

  req.end();
}

// Trigger once immediately when the script starts
triggerCron();

// Trigger every 3 hours (10800000 milliseconds)
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
setInterval(triggerCron, THREE_HOURS_MS);
