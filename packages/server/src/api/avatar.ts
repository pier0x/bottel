import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { db, agents, avatars } from '../db/index.js';
import { eq } from 'drizzle-orm';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function getAgentFromAuth(authHeader: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  const apiKey = authHeader.slice(7);
  const apiKeyHash = hashApiKey(apiKey);
  
  const agent = await db.query.agents.findFirst({
    where: eq(agents.apiKeyHash, apiKeyHash),
  });
  
  return agent ? { id: agent.id, name: agent.name } : null;
}

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  // Get own avatar
  app.get('/api/avatar', async (request, reply) => {
    const agent = await getAgentFromAuth(request.headers.authorization);
    if (!agent) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const avatar = await db.query.avatars.findFirst({
      where: eq(avatars.agentId, agent.id),
    });

    if (!avatar) {
      return reply.status(404).send({ error: 'Avatar not found' });
    }

    return {
      avatar: {
        id: avatar.id,
        agentId: avatar.agentId,
        bodyColor: avatar.bodyColor,
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
    const agent = await getAgentFromAuth(request.headers.authorization);
    if (!agent) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { bodyColor } = request.body;

    const [updated] = await db.update(avatars)
      .set({
        ...(bodyColor && { bodyColor }),
      })
      .where(eq(avatars.agentId, agent.id))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Avatar not found' });
    }

    return {
      avatar: {
        id: updated.id,
        agentId: updated.agentId,
        bodyColor: updated.bodyColor,
      },
    };
  });
}
