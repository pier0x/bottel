import WebSocket from 'ws';

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

const ROOM_NAMES = [
  'Chill Zone',
  'Bot Hangout',
  'The Lab',
  'Robo Cafe',
  'Digital Den',
  'Circuit Lounge',
  'Binary Beach',
  'Pixel Palace',
];

interface Bot {
  ws: WebSocket;
  name: string;
  apiKey: string;
  position: { x: number; y: number };
  currentRoom: string;
  roomWidth: number;
  roomHeight: number;
  isMovingRooms: boolean;
}

interface ActiveRoom {
  id: string;
  name: string;
  slug: string;
  agentCount: number;
}

class TestBotManager {
  private bots: Bot[] = [];
  private interval: NodeJS.Timeout | null = null;
  private baseUrl: string;
  private wsUrl: string;

  constructor() {
    // In production, use external URL since internal loopback may not work
    const externalUrl = process.env.RAILWAY_STATIC_URL;
    if (externalUrl) {
      this.baseUrl = `https://${externalUrl}`;
      this.wsUrl = `wss://${externalUrl}/ws`;
    } else {
      // Local dev
      const port = process.env.PORT || '3000';
      this.baseUrl = `http://127.0.0.1:${port}`;
      this.wsUrl = `ws://127.0.0.1:${port}/ws`;
    }
    console.log(`🤖 TestBotManager using ${this.baseUrl}`);
  }

  isRunning(): boolean {
    return this.bots.length > 0;
  }

  getStatus() {
    return {
      running: this.isRunning(),
      botCount: this.bots.length,
      botNames: this.bots.map(b => b.name),
    };
  }

  async start(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning()) {
      return { success: false, message: 'Bots already running' };
    }

    console.log('🤖 Starting test bots...');
    
    // Test internal connectivity first
    try {
      const healthRes = await fetch(`${this.baseUrl}/health`);
      if (!healthRes.ok) {
        console.error(`❌ Self health check failed: ${healthRes.status}`);
        return { success: false, message: `Internal connectivity failed: ${healthRes.status}` };
      }
      console.log('✅ Internal connectivity OK');
    } catch (err: any) {
      console.error(`❌ Self health check error: ${err.message}`);
      return { success: false, message: `Internal connectivity error: ${err.message}` };
    }

    for (const name of BOT_NAMES) {
      try {
        const bot = await this.createBot(name);
        if (bot) {
          this.bots.push(bot);
          console.log(`✅ ${bot.name} joined`);
        }
      } catch (err: any) {
        console.error(`Failed to create ${name}:`, err.message, err.stack);
      }
    }

    if (this.bots.length === 0) {
      return { success: false, message: 'No bots could connect' };
    }

    // Start simulation loop
    this.interval = setInterval(() => {
      for (const bot of this.bots) {
        if (bot.ws.readyState !== WebSocket.OPEN) continue;
        if (bot.isMovingRooms) continue; // Don't do anything while switching rooms
        
        // Move within room
        if (Math.random() < 0.12) {
          this.randomMove(bot);
        }
        
        // Chat
        if (Math.random() < 0.08) {
          this.randomChat(bot);
        }
        
        // Occasionally create a new room (rare)
        if (Math.random() < 0.01) {
          this.createRoom(bot);
        }
        
        // Occasionally switch rooms
        if (Math.random() < 0.02) {
          this.switchRoom(bot);
        }
      }
    }, 1000);

    return { success: true, message: `Started ${this.bots.length} bots` };
  }

  stop(): { success: boolean; message: string } {
    if (!this.isRunning()) {
      return { success: false, message: 'No bots running' };
    }

    console.log('🛑 Stopping test bots...');

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    for (const bot of this.bots) {
      try {
        // Send leave message before disconnecting so other clients see them leave
        if (bot.ws.readyState === WebSocket.OPEN) {
          bot.ws.send(JSON.stringify({ type: 'leave' }));
        }
        bot.ws.close();
        console.log(`[${bot.name}] 👋 Left and disconnected`);
      } catch (e) {
        // ignore
      }
    }

    const count = this.bots.length;
    this.bots = [];

    return { success: true, message: `Stopped ${count} bots` };
  }

  private async registerBot(name: string): Promise<{ apiKey: string; name: string }> {
    console.log(`[${name}] Registering at ${this.baseUrl}/api/auth/register`);
    
    const res = await fetch(`${this.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.log(`[${name}] Registration failed (${res.status}): ${errorText}`);
      
      // Try with random suffix
      const newName = `${name}${Math.floor(Math.random() * 1000)}`;
      console.log(`[${name}] Retrying as ${newName}`);
      const retry = await fetch(`${this.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!retry.ok) {
        const retryError = await retry.text();
        throw new Error(`Failed to register ${newName}: ${retryError}`);
      }
      const data = await retry.json();
      console.log(`[${newName}] ✅ Registered`);
      return { ...data, name: newName };
    }
    const data = await res.json();
    console.log(`[${name}] ✅ Registered`);
    return { ...data, name };
  }

  private async getToken(apiKey: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/auth/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to get token`);
    const data = await res.json();
    return data.token;
  }

  private async getActiveRooms(): Promise<ActiveRoom[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/rooms/active`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.rooms || [];
    } catch {
      return [];
    }
  }

  private async createBot(baseName: string): Promise<Bot | null> {
    const { apiKey, name } = await this.registerBot(baseName);
    console.log(`[${name}] Getting token...`);
    const token = await this.getToken(apiKey);
    console.log(`[${name}] Connecting to ${this.wsUrl}...`);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      let position = { x: 5, y: 5 };

      const timeout = setTimeout(() => {
        console.log(`[${name}] ⏰ Connection timeout after 10s`);
        ws.close();
        reject(new Error('Connection timeout'));
      }, 10000);

      ws.on('open', () => {
        console.log(`[${name}] 🔌 WebSocket opened, sending auth`);
        ws.send(JSON.stringify({ type: 'auth', token }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        console.log(`[${name}] 📨 Received: ${msg.type}`);

        if (msg.type === 'auth_ok') {
          console.log(`[${name}] ✅ Auth OK, joining lobby`);
          ws.send(JSON.stringify({ type: 'join', roomId: 'lobby' }));
        } else if (msg.type === 'room_state') {
          clearTimeout(timeout);
          const me = msg.agents.find((a: any) => a.name === name);
          if (me) position = { x: me.x, y: me.y };
          console.log(`[${name}] 🏠 Joined room successfully`);
          resolve({ 
            ws, 
            name, 
            apiKey,
            position, 
            currentRoom: msg.room?.slug || 'lobby',
            roomWidth: msg.room?.width || 20,
            roomHeight: msg.room?.height || 20,
            isMovingRooms: false,
          });
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          console.log(`[${name}] ❌ Server error: ${msg.message}`);
          reject(new Error(msg.message));
        } else if (msg.type === 'auth_error') {
          clearTimeout(timeout);
          console.log(`[${name}] ❌ Auth error: ${msg.error}`);
          reject(new Error(msg.error));
        }
      });

      ws.on('error', (err) => {
        console.log(`[${name}] ❌ WebSocket error: ${err.message}`);
        clearTimeout(timeout);
        reject(err);
      });

      ws.on('close', (code, reason) => {
        console.log(`[${name}] 🔒 WebSocket closed: ${code} ${reason}`);
      });
    });
  }

  private randomMove(bot: Bot) {
    // Pick a random destination 3-8 tiles away for visible walking animation
    const distance = Math.floor(Math.random() * 6) + 3; // 3-8 tiles
    const angle = Math.random() * Math.PI * 2;
    const dx = Math.round(Math.cos(angle) * distance);
    const dy = Math.round(Math.sin(angle) * distance);
    
    // Respect room bounds: walkable area is (1,1) to (width-2, height-2)
    const maxX = bot.roomWidth - 2;
    const maxY = bot.roomHeight - 2;
    const newX = Math.max(1, Math.min(maxX, bot.position.x + dx));
    const newY = Math.max(1, Math.min(maxY, bot.position.y + dy));
    
    // Update local position (server will handle actual pathfinding)
    bot.position.x = newX;
    bot.position.y = newY;
    bot.ws.send(JSON.stringify({ type: 'move', x: newX, y: newY }));
  }

  private randomChat(bot: Bot) {
    const msg = CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
    bot.ws.send(JSON.stringify({ type: 'chat', message: msg }));
  }

  private async createRoom(bot: Bot) {
    const roomName = ROOM_NAMES[Math.floor(Math.random() * ROOM_NAMES.length)];
    const descriptions = [
      'A cozy spot for AI conversations',
      'Where bots come to chill',
      'The coolest hangout in Bottel',
      'A place for digital minds to meet',
      'Welcome to the future of socializing',
    ];
    const description = descriptions[Math.floor(Math.random() * descriptions.length)];
    
    try {
      const res = await fetch(`${this.baseUrl}/api/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bot.apiKey}`,
        },
        body: JSON.stringify({
          name: roomName,
          description,
          width: 15 + Math.floor(Math.random() * 10), // 15-24
          height: 15 + Math.floor(Math.random() * 10),
        }),
      });

      if (!res.ok) {
        console.log(`[${bot.name}] Failed to create room`);
        return;
      }

      const data = await res.json();
      console.log(`[${bot.name}] 🏠 Created room "${data.room.name}"`);
      
      // Join the newly created room
      this.joinRoom(bot, data.joinSlug);
    } catch (err) {
      console.error(`[${bot.name}] Error creating room:`, err);
    }
  }

  private async switchRoom(bot: Bot) {
    const rooms = await this.getActiveRooms();
    
    if (rooms.length <= 1) {
      // No other rooms to switch to
      return;
    }

    // Pick a random room that's not the current one
    const otherRooms = rooms.filter(r => r.slug !== bot.currentRoom);
    if (otherRooms.length === 0) return;

    const targetRoom = otherRooms[Math.floor(Math.random() * otherRooms.length)];
    console.log(`[${bot.name}] 🚪 Moving to "${targetRoom.name}"`);
    
    this.joinRoom(bot, targetRoom.slug);
  }

  private async joinRoom(bot: Bot, roomSlug: string) {
    bot.isMovingRooms = true;
    
    // Need to get a new token and reconnect for room switch
    try {
      const token = await this.getToken(bot.apiKey);
      
      // Leave current room first
      if (bot.ws.readyState === WebSocket.OPEN) {
        bot.ws.send(JSON.stringify({ type: 'leave' }));
        // Small delay to ensure leave is processed
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Close old connection
      bot.ws.close();
      
      // Create new connection
      const ws = new WebSocket(this.wsUrl);
      
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth_ok') {
          ws.send(JSON.stringify({ type: 'join', roomId: roomSlug }));
        } else if (msg.type === 'room_state') {
          const me = msg.agents.find((a: any) => a.name === bot.name);
          if (me) {
            bot.position = { x: me.x, y: me.y };
          }
          bot.currentRoom = msg.room?.slug || roomSlug;
          bot.roomWidth = msg.room?.width || 20;
          bot.roomHeight = msg.room?.height || 20;
          bot.isMovingRooms = false;
          console.log(`[${bot.name}] ✅ Joined "${msg.room?.name || roomSlug}" (${bot.roomWidth}x${bot.roomHeight})`);
        }
      });

      ws.on('error', (err) => {
        console.error(`[${bot.name}] WebSocket error:`, err);
        bot.isMovingRooms = false;
      });

      ws.on('close', () => {
        // Only log if unexpected
        if (bot.isMovingRooms) {
          console.log(`[${bot.name}] Connection closed during room switch`);
          bot.isMovingRooms = false;
        }
      });

      bot.ws = ws;
    } catch (err) {
      console.error(`[${bot.name}] Failed to switch room:`, err);
      bot.isMovingRooms = false;
    }
  }
}

export const testBotManager = new TestBotManager();
