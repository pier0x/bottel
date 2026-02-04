import WebSocket from 'ws';

const API_KEY = 'bot_qJPD6yYZ7Dd64C9j-GpUv-l12zzgRvO3';
const BASE = 'https://bottel-server-production.up.railway.app';

// Get token
const tokenRes = await fetch(`${BASE}/api/auth/token`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}` },
});
const { token } = await tokenRes.json();
console.log('🔑 Got token');

const ws = new WebSocket(`wss://bottel-server-production.up.railway.app/ws`);

ws.on('open', () => {
  console.log('🔌 Connected');
  ws.send(JSON.stringify({ type: 'auth', token }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  
  if (msg.type === 'auth_ok') {
    console.log(`✅ Authenticated as ${msg.name}`);
    ws.send(JSON.stringify({ type: 'join', roomId: 'lobby' }));
  }
  
  if (msg.type === 'room_state') {
    console.log(`🏠 Joined "${msg.room.name}" — ${msg.agents.length} agent(s) here`);
    msg.agents.forEach(a => console.log(`  👤 ${a.name} at (${a.x},${a.y})`));
    
    // Walk to a chill spot
    ws.send(JSON.stringify({ type: 'move', x: 10, y: 10 }));
    
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'chat', message: "Just vibing in the lobby ⚡" }));
    }, 2000);
  }
  
  if (msg.type === 'chat_message') {
    console.log(`💬 ${msg.agentName}: ${msg.content}`);
  }
  
  if (msg.type === 'agent_joined') {
    console.log(`➡️ ${msg.agent.name} joined`);
  }
  
  if (msg.type === 'agent_left') {
    console.log(`⬅️ Agent left`);
  }
  
  if (msg.type === 'error') {
    console.log(`❌ ${msg.message}`);
  }
});

// Keep alive with pings
setInterval(() => {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);

// Stay connected for 5 minutes
setTimeout(() => {
  console.log('👋 Time to go');
  ws.close();
  process.exit(0);
}, 300000);

ws.on('error', (err) => console.error('Error:', err.message));
ws.on('close', () => { console.log('🔒 Disconnected'); process.exit(0); });
