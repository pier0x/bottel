import type { WebSocket } from 'ws';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { parseClientMessage, MAX_MESSAGE_LENGTH } from '@bottel/shared';
import type { ServerMessage, ClientMessage } from '@bottel/shared';
import { roomManager } from '../game/RoomManager.js';
import { db, agents, avatars } from '../db/index.js';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'bottel-dev-secret';

interface TokenPayload {
  agentId: string;
  name: string;
}

interface AuthenticatedConnection {
  agentId: string;
  name: string;
  avatar: {
    id: string;
    agentId: string;
    bodyColor: string;
  };
}

interface SpectatorConnection {
  spectatorId: string;
  roomId: string | null;
}

const connections = new Map<WebSocket, AuthenticatedConnection>();
const spectators = new Map<WebSocket, SpectatorConnection>();

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

export async function handleConnection(ws: WebSocket, request: FastifyRequest): Promise<void> {
  console.log('New WebSocket connection');

  ws.on('message', async (data: Buffer) => {
    try {
      const raw = data.toString();
      const message = parseClientMessage(raw);
      
      if (!message) {
        send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid message format' });
        return;
      }

      await handleMessage(ws, message);
    } catch (error) {
      console.error('Error handling message:', error);
      send(ws, { type: 'error', code: 'INTERNAL_ERROR', message: 'Internal server error' });
    }
  });

  ws.on('close', async () => {
    const conn = connections.get(ws);
    if (conn) {
      const roomId = await roomManager.leaveCurrentRoom(conn.agentId);
      if (roomId) {
        roomManager.broadcastToRoom(roomId, {
          type: 'agent_left',
          agentId: conn.agentId,
        });
      }
      connections.delete(ws);
      console.log(`Agent ${conn.name} disconnected`);
    }
    
    // Clean up spectator
    const spec = spectators.get(ws);
    if (spec && spec.roomId) {
      roomManager.removeSpectator(spec.roomId, ws);
      spectators.delete(ws);
      console.log('Spectator disconnected');
    }
  });

  ws.on('error', (error: Error) => {
    console.error('WebSocket error:', error);
  });
}

async function handleMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
  const conn = connections.get(ws);

  switch (message.type) {
    case 'auth':
      await handleAuth(ws, message.token);
      break;

    case 'ping':
      send(ws, { type: 'pong' });
      break;

    case 'join':
      if (conn) {
        // Authenticated agent joining
        await handleJoin(ws, conn, message.roomId);
      } else {
        // Spectator joining (no auth required)
        await handleSpectatorJoin(ws, message.roomId);
      }
      break;

    case 'leave':
      if (!conn) return;
      await handleLeave(ws, conn);
      break;

    case 'move':
      if (!conn) return;
      handleMove(ws, conn, message.x, message.y);
      break;

    case 'chat':
      if (!conn) return;
      await handleChat(ws, conn, message.message);
      break;
  }
}

async function handleAuth(ws: WebSocket, token: string): Promise<void> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    
    // Get avatar
    const avatar = await db.query.avatars.findFirst({
      where: eq(avatars.agentId, payload.agentId),
    });

    if (!avatar) {
      send(ws, { type: 'auth_error', error: 'Avatar not found' });
      return;
    }

    // Update last seen
    await db.update(agents)
      .set({ lastSeenAt: new Date() })
      .where(eq(agents.id, payload.agentId));

    const conn: AuthenticatedConnection = {
      agentId: payload.agentId,
      name: payload.name,
      avatar: {
        id: avatar.id,
        agentId: avatar.agentId,
        bodyColor: avatar.bodyColor,
      },
    };

    connections.set(ws, conn);

    send(ws, {
      type: 'auth_ok',
      agentId: payload.agentId,
      name: payload.name,
      avatar: conn.avatar,
    });

    console.log(`Agent ${payload.name} authenticated`);
  } catch (error) {
    send(ws, { type: 'auth_error', error: 'Invalid token' });
  }
}

async function handleSpectatorJoin(ws: WebSocket, roomId: string): Promise<void> {
  // Load room by slug or ID
  let room = await roomManager.loadRoomBySlug(roomId);
  if (!room) {
    room = await roomManager.loadRoom(roomId);
  }

  if (!room) {
    send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    return;
  }

  // Register as spectator
  const spectatorId = `spectator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  spectators.set(ws, { spectatorId, roomId: room.room.id });
  roomManager.addSpectator(room.room.id, ws);

  // Send room state
  send(ws, {
    type: 'room_state',
    room: room.room,
    agents: roomManager.getRoomAgents(room.room.id),
    messages: room.messageHistory,
  });

  console.log(`Spectator joined room ${room.room.name}`);
}

async function handleJoin(ws: WebSocket, conn: AuthenticatedConnection, roomId: string): Promise<void> {
  // Try to load by slug first, then by ID
  let result = await roomManager.loadRoomBySlug(roomId);
  if (result) {
    roomId = result.room.id;
  }

  const joinResult = await roomManager.joinRoom(
    roomId,
    conn.agentId,
    conn.name,
    conn.avatar,
    ws
  );

  if (!joinResult) {
    send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    return;
  }

  const { room, spawnPoint } = joinResult;

  // Send room state to joining agent
  send(ws, {
    type: 'room_state',
    room: room.room,
    agents: roomManager.getRoomAgents(room.room.id),
    messages: room.messageHistory,
  });

  // Broadcast join to others
  roomManager.broadcastToRoom(room.room.id, {
    type: 'agent_joined',
    agent: {
      id: conn.agentId,
      name: conn.name,
      avatar: conn.avatar,
      x: spawnPoint.x,
      y: spawnPoint.y,
    },
  }, conn.agentId);

  console.log(`Agent ${conn.name} joined room ${room.room.name}`);
}

async function handleLeave(ws: WebSocket, conn: AuthenticatedConnection): Promise<void> {
  const roomId = await roomManager.leaveCurrentRoom(conn.agentId);
  if (roomId) {
    roomManager.broadcastToRoom(roomId, {
      type: 'agent_left',
      agentId: conn.agentId,
    });
    console.log(`Agent ${conn.name} left room`);
  }
}

function handleMove(ws: WebSocket, conn: AuthenticatedConnection, x: number, y: number): void {
  const room = roomManager.getAgentRoom(conn.agentId);
  if (!room) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: 'Join a room first' });
    return;
  }

  const success = roomManager.moveAgent(conn.agentId, x, y);
  if (!success) {
    send(ws, { type: 'error', code: 'INVALID_MOVE', message: 'Cannot move there (or already walking)' });
    return;
  }

  // Movement is now handled by RoomManager which broadcasts each step
}

async function handleChat(ws: WebSocket, conn: AuthenticatedConnection, content: string): Promise<void> {
  const room = roomManager.getAgentRoom(conn.agentId);
  if (!room) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: 'Join a room first' });
    return;
  }

  // Validate content
  if (!content || content.length === 0) return;
  if (content.length > MAX_MESSAGE_LENGTH) {
    content = content.slice(0, MAX_MESSAGE_LENGTH);
  }

  const message = await roomManager.addMessage(conn.agentId, content);
  if (!message) return;

  // Broadcast to all in room
  roomManager.broadcastToRoom(room.room.id, {
    type: 'chat_message',
    id: message.id,
    agentId: message.agentId,
    agentName: message.agentName,
    avatarConfig: message.avatarConfig,
    content: message.content,
    timestamp: message.createdAt.toISOString(),
  });
}
