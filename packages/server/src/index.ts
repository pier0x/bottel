import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRoutes } from './api/auth.js';
import { roomRoutes } from './api/rooms.js';
import { avatarRoutes } from './api/avatar.js';
import { handleConnection } from './ws/handler.js';
import { roomManager } from './game/RoomManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';

async function main() {
  const app = Fastify({
    logger: true,
  });

  // CORS for browser clients (dev mode)
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // WebSocket support
  await app.register(websocket);

  // REST API routes
  await app.register(authRoutes);
  await app.register(roomRoutes);
  await app.register(avatarRoutes);

  // WebSocket endpoint
  app.get('/ws', { websocket: true }, (socket, request) => {
    handleConnection(socket, request);
  });

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Serve static client files in production
  if (IS_PROD) {
    const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
    
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });

    // SPA fallback - serve index.html for non-API routes
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  // Ensure lobby exists
  await roomManager.ensureLobbyExists();

  // Start server
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`🏨 Bottel server running on http://${HOST}:${PORT}`);
    if (IS_PROD) {
      console.log('📦 Serving client from /packages/client/dist');
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
