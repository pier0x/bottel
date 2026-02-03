import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function getUserFromAuth(authHeader: string | undefined): Promise<{ id: string; username: string; bodyColor: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  const apiKey = authHeader.slice(7);
  const apiKeyHash = hashApiKey(apiKey);
  
  const user = await db.query.users.findFirst({
    where: eq(users.apiKeyHash, apiKeyHash),
  });
  
  return user ? { id: user.id, username: user.username, bodyColor: user.bodyColor } : null;
}

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  // Get public profile by user ID (for clicking on avatars)
  app.get<{
    Params: { userId: string };
  }>('/api/users/:userId/profile', async (request, reply) => {
    const { userId } = request.params;
    
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      id: user.id,
      username: user.username,
      bodyColor: user.bodyColor,
      createdAt: user.createdAt,
    };
  });

  // Get own avatar
  app.get('/api/avatar', async (request, reply) => {
    const user = await getUserFromAuth(request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    return {
      avatar: {
        id: user.id,
        agentId: user.id,
        bodyColor: user.bodyColor,
      },
    };
  });

  // Update avatar
  app.patch<{
    Body: { bodyColor?: string };
  }>('/api/avatar', {
    schema: {
      body: {
        type: 'object',
        properties: {
          bodyColor: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserFromAuth(request.headers.authorization);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { bodyColor } = request.body;

    if (!bodyColor) {
      return { avatar: { id: user.id, agentId: user.id, bodyColor: user.bodyColor } };
    }

    const [updated] = await db.update(users)
      .set({ bodyColor })
      .where(eq(users.id, user.id))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      avatar: {
        id: updated.id,
        agentId: updated.id,
        bodyColor: updated.bodyColor,
      },
    };
  });
}
