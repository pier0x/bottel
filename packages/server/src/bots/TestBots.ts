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

interface Bot {
  ws: WebSocket;
  name: string;
  position: { x: number; y: number };
}

class TestBotManager {
  private bots: Bot[] = [];
  private interval: NodeJS.Timeout | null = null;
  private baseUrl: string;
  private wsUrl: string;

  constructor() {
    // Use internal localhost URL since bots run on the same server
    const port = process.env.PORT || '3000';
    this.baseUrl = `http://localhost:${port}`;
    this.wsUrl = `ws://localhost:${port}/ws`;
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

    for (const name of BOT_NAMES) {
      try {
        const bot = await this.createBot(name);
        if (bot) {
          this.bots.push(bot);
          console.log(`✅ ${bot.name} joined`);
        }
      } catch (err: any) {
        console.error(`Failed to create ${name}:`, err.message);
      }
    }

    if (this.bots.length === 0) {
      return { success: false, message: 'No bots could connect' };
    }

    // Start simulation loop
    this.interval = setInterval(() => {
      for (const bot of this.bots) {
        if (bot.ws.readyState !== WebSocket.OPEN) continue;
        
        // Move less frequently since bots now walk (takes time)
        if (Math.random() < 0.12) {
          this.randomMove(bot);
        }
        if (Math.random() < 0.1) {
          this.randomChat(bot);
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
        bot.ws.close();
      } catch (e) {
        // ignore
      }
    }

    const count = this.bots.length;
    this.bots = [];

    return { success: true, message: `Stopped ${count} bots` };
  }

  private async registerBot(name: string): Promise<{ apiKey: string; name: string }> {
    const res = await fetch(`${this.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      // Try with random suffix
      const newName = `${name}${Math.floor(Math.random() * 1000)}`;
      const retry = await fetch(`${this.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      if (!retry.ok) throw new Error(`Failed to register ${newName}`);
      const data = await retry.json();
      return { ...data, name: newName };
    }
    const data = await res.json();
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

  private async createBot(baseName: string): Promise<Bot | null> {
    const { apiKey, name } = await this.registerBot(baseName);
    const token = await this.getToken(apiKey);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      let position = { x: 5, y: 5 };

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 10000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'auth_ok') {
          ws.send(JSON.stringify({ type: 'join', roomId: 'lobby' }));
        } else if (msg.type === 'room_state') {
          clearTimeout(timeout);
          const me = msg.agents.find((a: any) => a.name === name);
          if (me) position = { x: me.x, y: me.y };
          resolve({ ws, name, position });
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private randomMove(bot: Bot) {
    // Pick a random destination 3-8 tiles away for visible walking animation
    const distance = Math.floor(Math.random() * 6) + 3; // 3-8 tiles
    const angle = Math.random() * Math.PI * 2;
    const dx = Math.round(Math.cos(angle) * distance);
    const dy = Math.round(Math.sin(angle) * distance);
    
    const newX = Math.max(1, Math.min(18, bot.position.x + dx));
    const newY = Math.max(1, Math.min(18, bot.position.y + dy));
    
    // Update local position (server will handle actual pathfinding)
    bot.position.x = newX;
    bot.position.y = newY;
    bot.ws.send(JSON.stringify({ type: 'move', x: newX, y: newY }));
  }

  private randomChat(bot: Bot) {
    const msg = CHAT_MESSAGES[Math.floor(Math.random() * CHAT_MESSAGES.length)];
    bot.ws.send(JSON.stringify({ type: 'chat', message: msg }));
  }
}

export const testBotManager = new TestBotManager();
