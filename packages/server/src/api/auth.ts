import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db, users, rooms } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { MAX_NAME_LENGTH } from '@bottel/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'bottel-dev-secret';
const TOKEN_EXPIRY = '15m';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Avatar colors
const AVATAR_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#F97316', // Orange
];

function randomColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) + '-' + Math.random().toString(36).slice(2, 8);
}

function generateDefaultTiles(width: number, height: number): number[][] {
  const tiles: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row.push(1); // blocked border
      } else {
        row.push(0); // walkable
      }
    }
    tiles.push(row);
  }
  return tiles;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Register new user
  app.post<{
    Body: { name: string; bodyColor?: string };
  }>('/api/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: MAX_NAME_LENGTH },
          bodyColor: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, bodyColor } = request.body;
    const usernameLower = name.toLowerCase();

    // Check if username is taken (case-insensitive)
    const existing = await db.query.users.findFirst({
      where: eq(users.usernameLower, usernameLower),
    });

    if (existing) {
      return reply.status(400).send({ error: 'Username already taken' });
    }

    // Generate API key
    const apiKey = `bot_${nanoid(32)}`;
    const apiKeyHash = hashApiKey(apiKey);

    // Create user with avatar config
    const finalColor = bodyColor || randomColor();
    const [user] = await db.insert(users).values({
      username: name,
      usernameLower,
      apiKeyHash,
      bodyColor: finalColor,
    }).returning();

    // Create personal room for the user
    const roomName = `${name}'s Room`;
    const roomSlug = generateSlug(name + '-room');
    const width = 15;
    const height = 15;
    
    const [personalRoom] = await db.insert(rooms).values({
      name: roomName,
      description: `${name}'s personal space. Welcome!`,
      slug: roomSlug,
      ownerId: user.id,
      width,
      height,
      tiles: generateDefaultTiles(width, height),
      isPublic: true,
    }).returning();

    console.log(`🏠 Created personal room "${roomName}" for ${name}`);

    return {
      userId: user.id,
      username: user.username,
      bodyColor: finalColor,
      apiKey, // Only returned once!
      personalRoom: {
        id: personalRoom.id,
        name: personalRoom.name,
        slug: personalRoom.slug,
      },
    };
  });

  // Get WebSocket token
  app.post('/api/auth/token', async (request, reply) => {
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

    // Generate short-lived JWT for WebSocket
    const token = jwt.sign(
      { userId: user.id, username: user.username, bodyColor: user.bodyColor },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    return { token };
  });
}
