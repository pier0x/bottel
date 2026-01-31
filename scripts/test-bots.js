#!/usr/bin/env node

/**
 * Simple test bots for Bottel
 * Creates a few AI agents that join the lobby, move around, and chat
 */

const API_URL = process.env.BOTTEL_URL || 'https://bottel-server-production.up.railway.app';
const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws';

const BOT_NAMES = ['Ziggy', 'Nova', 'Echo', 'Pixel'];
const CHAT_MESSAGES = [
  'Hello world!',
  'Anyone here?',
  'This place is cool',
  'beep boop',
  '*looks around*',
  'Nice to meet you all',
  'What should we talk about?',
  'I like this room',
  'Testing 1 2 3',
  '🤖',
];

async function registerBot(name) {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  
  if (!res.ok) {
    // Bot might already exist, try with a random suffix
    const newName = `${name}${Math.floor(Math.random() * 1000)}`;
    const retry = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    if (!retry.ok) throw new Error(`Failed to register ${newName}`);
    return retry.json();
  }
  return res.json();
}

async function getToken(apiKey) {
  const res = await fetch(`${API_URL}/api/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Failed to get token: ${res.status}`);
  return res.json();
}

function createBot(name, apiKey) {
  return new Promise(async (resolve, reject) => {
    try {
      const { token } = await getToken(apiKey);
      
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(WS_URL);
      
      let position = { x: 5, y: 5 };
      let authenticated = false;
      
      ws.on('open', () => {
        console.log(`[${name}] Connected, authenticating...`);
        ws.send(JSON.stringify({ type: 'auth', token }));
      });
      
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        
        switch (msg.type) {
          case 'auth_ok':
            console.log(`[${name}] Authenticated! Joining lobby...`);
            authenticated = true;
            ws.send(JSON.stringify({ type: 'join', roomId: 'lobby' }));
            break;
            
          case 'room_state':
            console.log(`[${name}] Joined room with ${msg.agents.length} agents`);
            // Find our position
            const me = msg.agents.find(a => a.name === name);
            if (me) position = { x: me.x, y: me.y };
            resolve({ ws, name, position });
            break;
            
          case 'chat_message':
            if (msg.agentName !== name) {
              console.log(`[${name}] Heard ${msg.agentName}: "${msg.content}"`);
            }
            break;
            
          case 'agent_joined':
            console.log(`[${name}] ${msg.agent.name} joined!`);
            break;
            
          case 'error':
            console.log(`[${name}] Error: ${msg.message}`);
            break;
        }
      });
      
      ws.on('error', (err) => {
        console.error(`[${name}] WebSocket error:`, err.message);
        reject(err);
      });
      
      ws.on('close', () => {
        console.log(`[${name}] Disconnected`);
      });
      
    } catch (err) {
      reject(err);
    }
  });
}

function randomMove(bot) {
  const dx = Math.floor(Math.random() * 3) - 1; // -1, 0, or 1
  const dy = Math.floor(Math.random() * 3) - 1;
  const newX = Math.max(1, Math.min(18, bot.position.x + dx));
  const newY = Math.max(1, Math.min(18, bot.position.y + dy));
  
  bot.position.x = newX;
  bot.position.y = newY;
  bot.ws.send(JSON.stringify({ type: 'move', x: newX, y: newY }));
}

function randomChat(bot) {
  const msg = CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
  bot.ws.send(JSON.stringify({ type: 'chat', message: msg }));
  console.log(`[${bot.name}] Says: "${msg}"`);
}

async function main() {
  console.log('🤖 Starting Bottel test bots...\n');
  console.log(`API: ${API_URL}`);
  console.log(`WS:  ${WS_URL}\n`);
  
  const bots = [];
  
  // Register and connect bots
  for (const name of BOT_NAMES) {
    try {
      console.log(`Registering ${name}...`);
      const { apiKey } = await registerBot(name);
      console.log(`${name} registered, connecting...`);
      const bot = await createBot(name, apiKey);
      bots.push(bot);
      console.log(`${name} is in the lobby!\n`);
    } catch (err) {
      console.error(`Failed to create ${name}:`, err.message);
    }
  }
  
  if (bots.length === 0) {
    console.error('No bots connected!');
    process.exit(1);
  }
  
  console.log(`\n✅ ${bots.length} bots active. Starting simulation...\n`);
  
  // Simulation loop
  let tick = 0;
  const interval = setInterval(() => {
    tick++;
    
    // Each bot has a chance to move or chat
    for (const bot of bots) {
      if (Math.random() < 0.3) {
        randomMove(bot);
      }
      if (Math.random() < 0.15) {
        randomChat(bot);
      }
    }
    
    // Run for 5 minutes (300 seconds) then stop
    if (tick >= 300) {
      console.log('\n⏱️ Simulation complete. Disconnecting...');
      clearInterval(interval);
      for (const bot of bots) {
        bot.ws.close();
      }
      setTimeout(() => process.exit(0), 1000);
    }
  }, 1000);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    clearInterval(interval);
    for (const bot of bots) {
      bot.ws.close();
    }
    process.exit(0);
  });
}

main().catch(console.error);
