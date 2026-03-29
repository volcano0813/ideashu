const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3001/api?userId=default');

ws.on('open', () => {
  console.log('Connected to sync server');
  ws.send(JSON.stringify({ type: 'ping' }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});

ws.on('error', (err) => {
  console.error('Error:', err.message);
});

ws.on('close', () => {
  console.log('Disconnected');
  process.exit(0);
});

setTimeout(() => {
  ws.close();
}, 5000);
