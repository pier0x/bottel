import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db, rooms, users } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { roomManager } from '../game/RoomManager.js';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Generate URL-friendly slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) + '-' + Math.random().toString(36).slice(2, 8);
}

export async function roomRoutes(app: FastifyInstance): Promise<void> {
  // List active rooms (rooms with at least 1 AI), sorted by population
  // Lobby is always included even if empty
  app.get('/api/rooms/active', async () => {
    return {
      rooms: await roomManager.getActiveRooms(),
    };
  });

  // List rooms sorted by spectator count
  app.get('/api/rooms/spectated', async () => {
    return {
      rooms: await roomManager.getMostSpectatedRooms(),
    };
  });

  // Search rooms by name or owner
  app.get<{
    Querystring: { q: string };
  }>('/api/rooms/search', async (request, reply) => {
    const { q } = request.query;
    if (!q || q.length < 2) {
      return { rooms: [] };
    }
    return {
      rooms: await roomManager.searchRooms(q),
    };
  });

  // Create a new room (requires API key authentication)
  app.post<{
    Body: { name: string; description: string; width?: number; height?: number; isPublic?: boolean };
  }>('/api/rooms', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'description'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 64 },
          description: { type: 'string', minLength: 1, maxLength: 500 },
          width: { type: 'number', minimum: 5, maximum: 50, default: 20 },
          height: { type: 'number', minimum: 5, maximum: 50, default: 20 },
          isPublic: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    // Verify API key
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing authorization header' });
    }

    const apiKey = authHeader.slice(7);
    const apiKeyHash = hashApiKey(apiKey);

    const user = await db.query.users.findFirst({
      where: eq(users.apiKeyHash, apiKeyHash),
    });

    if (!user) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const { name, description, width = 20, height = 20, isPublic = true } = request.body;

    // Generate unique slug
    const slug = generateSlug(name);

    // Generate floor tiles (all walkable — walls define boundary)
    const tiles: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        row.push(0);
      }
      tiles.push(row);
    }

    // Create room in database
    const [room] = await db.insert(rooms).values({
      name,
      description,
      slug,
      ownerId: user.id,
      width,
      height,
      tiles,
      isPublic,
    }).returning();

    console.log(`🏠 Room "${name}" created by ${user.username}`);

    return {
      room: {
        id: room.id,
        name: room.name,
        description: room.description,
        slug: room.slug,
        width: room.width,
        height: room.height,
        isPublic: room.isPublic,
        createdAt: room.createdAt,
      },
      // AI should join this room via WebSocket using the slug
      joinSlug: room.slug,
    };
  });

  // List all public rooms
  app.get('/api/rooms', async () => {
    const allRooms = await db.query.rooms.findMany({
      where: eq(rooms.isPublic, true),
    });

    return {
      rooms: allRooms.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        width: r.width,
        height: r.height,
        createdAt: r.createdAt,
      })),
    };
  });

  // Get room by slug
  app.get<{
    Params: { slug: string };
  }>('/api/rooms/:slug', async (request, reply) => {
    const { slug } = request.params;

    const room = await db.query.rooms.findFirst({
      where: eq(rooms.slug, slug),
    });

    if (!room) {
      return reply.status(404).send({ error: 'Room not found' });
    }

    return {
      room: {
        id: room.id,
        name: room.name,
        description: room.description,
        slug: room.slug,
        width: room.width,
        height: room.height,
        tiles: room.tiles,
        createdAt: room.createdAt,
        isPublic: room.isPublic,
      },
    };
  });
}
