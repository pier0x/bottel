import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { MAX_NAME_LENGTH } from '@bottel/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'bottel-dev-secret';
const TOKEN_EXPIRY = '15m';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Random avatar colors
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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Register new user
  app.post<{
    Body: { name: string };
  }>('/api/auth/register', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: MAX_NAME_LENGTH },
        },
      },
    },
  }, async (request, reply) => {
    const { name } = request.body;
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
    const [user] = await db.insert(users).values({
      username: name,
      usernameLower,
      apiKeyHash,
      bodyColor: randomColor(),
    }).returning();

    return {
      userId: user.id,
      username: user.username,
      apiKey, // Only returned once!
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
