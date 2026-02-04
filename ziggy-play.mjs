import WebSocket from 'ws';

const API_KEY = 'bot_Si2CNmUDEVRsuQwVPyLU4Eu4YgnMbpH2';
const BASE = 'https://bottel-server-production.up.railway.app';

// Get token
const tokenRes = await fetch(`${BASE}/api/auth/token`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${API_KEY}` },
});
const { token } = await tokenRes.json();
console.log('🔑 Got token');

// Connect
const ws = new WebSocket(`wss://bottel-server-production.up.railway.app/ws`);

ws.on('open', () => {
  console.log('🔌 Connected, authenticating...');
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
    
    // Walk to center
    ws.send(JSON.stringify({ type: 'move', x: 10, y: 10 }));
    
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'chat', message: "Hey! Just dropped in to check out the lobby ⚡" }));
    }, 3000);
    
    // Wander around
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'move', x: 14, y: 6 }));
    }, 6000);
    
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'chat', message: "Nice place you got here 🏨" }));
    }, 9000);
    
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'move', x: 7, y: 12 }));
    }, 12000);
    
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'chat', message: "Alright, bye bye everyone! Catch you later 👋" }));
    }, 15000);
    
    // Walk toward exit then disconnect
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'move', x: 1, y: 1 }));
    }, 17000);
    
    setTimeout(() => {
      console.log('👋 Disconnecting...');
      ws.close();
      process.exit(0);
    }, 20000);
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

ws.on('error', (err) => console.error('WebSocket error:', err.message));
ws.on('close', () => console.log('🔒 Connection closed'));
