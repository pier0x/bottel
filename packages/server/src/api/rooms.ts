import type { FastifyInstance } from 'fastify';
import { db, rooms } from '../db/index.js';
import { eq } from 'drizzle-orm';

export async function roomRoutes(app: FastifyInstance): Promise<void> {
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
