const http = require('http');

const data = JSON.stringify({
  messages: [{ role: 'user', content: 'hi' }]
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, res => {
  console.log(`STATUS: ${res.statusCode}`);
  let body = '';
  res.on('data', d => { body += d; });
  res.on('end', () => {
    // If it's a 500 error page from next.js, extract the error message
    if (res.statusCode === 500) {
      const titleMatch = body.match(/<title>(.*?)<\/title>/);
      console.log('Error Title:', titleMatch ? titleMatch[1] : 'No title');
      const errMatch = body.match(/data-nextjs-dialog-header.*?>(.*?)<\/div>/s);
      if (errMatch) console.log('Error details:', errMatch[1].replace(/<[^>]+>/g, '').trim());
      else console.log('Raw body snapshot:', body.substring(0, 1000));
    } else {
      console.log('Response:', body);
    }
  });
});

req.on('error', error => { console.error('Req error:', error); });
req.write(data);
req.end();
