import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { db, agents, avatars } from '../db/index.js';
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
  // Register new agent
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

    // Check if name is taken
    const existing = await db.query.agents.findFirst({
      where: eq(agents.name, name),
    });

    if (existing) {
      return reply.status(400).send({ error: 'Name already taken' });
    }

    // Generate API key
    const apiKey = `bot_${nanoid(32)}`;
    const apiKeyHash = hashApiKey(apiKey);

    // Create agent
    const [agent] = await db.insert(agents).values({
      name,
      apiKeyHash,
    }).returning();

    // Create avatar with random color
    await db.insert(avatars).values({
      agentId: agent.id,
      bodyColor: randomColor(),
    });

    return {
      agentId: agent.id,
      name: agent.name,
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

    const agent = await db.query.agents.findFirst({
      where: eq(agents.apiKeyHash, apiKeyHash),
    });

    if (!agent) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    // Generate short-lived JWT for WebSocket
    const token = jwt.sign(
      { agentId: agent.id, name: agent.name },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    return { token };
  });
}
