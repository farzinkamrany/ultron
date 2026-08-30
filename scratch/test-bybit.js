const WebSocket = require('ws');

const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');

ws.on('open', () => {
  console.log('Connected to Bybit');
  ws.send(JSON.stringify({
    op: 'subscribe',
    args: ['orderbook.50.BTCUSDT']
  }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString().substring(0, 500));
  const parsed = JSON.parse(data.toString());
  if (parsed.topic === 'orderbook.50.BTCUSDT') {
      console.log('Got orderbook data!');
      process.exit(0);
  }
});

ws.on('error', console.error);

setTimeout(() => {
  console.log('Timeout');
  process.exit(1);
}, 10000);
