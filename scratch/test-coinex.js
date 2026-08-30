const WebSocket = require('ws');

const ws = new WebSocket('wss://socket.coinex.com/v2/spot');

ws.on('open', () => {
  console.log('Connected to CoinEx');
  ws.send(JSON.stringify({
    method: "depth.subscribe",
    params: {
      market_list: ["BTCUSDT"],
      limit: 10,
      interval: "0"
    },
    id: 1
  }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  const parsed = JSON.parse(data.toString());
  if (parsed.method === 'depth.update' || parsed.id === 1) {
    console.log(JSON.stringify(parsed, null, 2));
    if (parsed.method === 'depth.update') {
        process.exit(0);
    }
  }
});

ws.on('error', console.error);

setTimeout(() => {
  console.log('Timeout');
  process.exit(1);
}, 10000);
