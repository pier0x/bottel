import type { WebSocket } from 'ws';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { parseClientMessage, MAX_MESSAGE_LENGTH } from '@bottel/shared';
import type { ServerMessage, ClientMessage } from '@bottel/shared';
import { roomManager } from '../game/RoomManager.js';
import { db, users } from '../db/index.js';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'bottel-dev-secret';

interface TokenPayload {
  userId: string;
  username: string;
  bodyColor: string;
}

interface AuthenticatedConnection {
  userId: string;
  username: string;
  bodyColor: string;
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
      const roomId = await roomManager.leaveCurrentRoom(conn.userId);
      if (roomId) {
        roomManager.broadcastToRoom(roomId, {
          type: 'agent_left',
          agentId: conn.userId,
        });
      }
      connections.delete(ws);
      console.log(`User ${conn.username} disconnected`);
    }
    
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
        await handleJoin(ws, conn, message.roomId);
      } else {
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
    
    // Update last seen
    await db.update(users)
      .set({ lastSeenAt: new Date() })
      .where(eq(users.id, payload.userId));

    const conn: AuthenticatedConnection = {
      userId: payload.userId,
      username: payload.username,
      bodyColor: payload.bodyColor,
    };

    connections.set(ws, conn);

    send(ws, {
      type: 'auth_ok',
      agentId: payload.userId,
      name: payload.username,
      avatar: { id: payload.userId, agentId: payload.userId, bodyColor: payload.bodyColor },
    });

    console.log(`User ${payload.username} authenticated`);
  } catch (error) {
    send(ws, { type: 'auth_error', error: 'Invalid token' });
  }
}

async function handleSpectatorJoin(ws: WebSocket, roomId: string): Promise<void> {
  let room = await roomManager.loadRoomBySlug(roomId);
  if (!room) {
    room = await roomManager.loadRoom(roomId);
  }

  if (!room) {
    send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    return;
  }

  const existingSpec = spectators.get(ws);
  if (existingSpec && existingSpec.roomId && existingSpec.roomId !== room.room.id) {
    roomManager.removeSpectator(existingSpec.roomId, ws);
    console.log(`Spectator left room ${existingSpec.roomId}`);
  }

  const spectatorId = existingSpec?.spectatorId || `spectator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  spectators.set(ws, { spectatorId, roomId: room.room.id });
  roomManager.addSpectator(room.room.id, ws);

  send(ws, {
    type: 'room_state',
    room: room.room,
    agents: roomManager.getRoomUsers(room.room.id),
    messages: room.messageHistory,
  });

  console.log(`Spectator joined room ${room.room.name}`);
}

async function handleJoin(ws: WebSocket, conn: AuthenticatedConnection, roomId: string): Promise<void> {
  let result = await roomManager.loadRoomBySlug(roomId);
  if (result) {
    roomId = result.room.id;
  }

  const joinResult = await roomManager.joinRoom(
    roomId,
    conn.userId,
    conn.username,
    conn.bodyColor,
    ws
  );

  if (!joinResult) {
    send(ws, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found' });
    return;
  }

  const { room, spawnPoint } = joinResult;

  send(ws, {
    type: 'room_state',
    room: room.room,
    agents: roomManager.getRoomUsers(room.room.id),
    messages: room.messageHistory,
  });

  roomManager.broadcastToRoom(room.room.id, {
    type: 'agent_joined',
    agent: {
      id: conn.userId,
      name: conn.username,
      avatar: { id: conn.userId, agentId: conn.userId, bodyColor: conn.bodyColor },
      x: spawnPoint.x,
      y: spawnPoint.y,
    },
  }, conn.userId);

  console.log(`User ${conn.username} joined room ${room.room.name}`);
}

async function handleLeave(ws: WebSocket, conn: AuthenticatedConnection): Promise<void> {
  const roomId = await roomManager.leaveCurrentRoom(conn.userId);
  if (roomId) {
    roomManager.broadcastToRoom(roomId, {
      type: 'agent_left',
      agentId: conn.userId,
    });
    console.log(`User ${conn.username} left room`);
  }
}

function handleMove(ws: WebSocket, conn: AuthenticatedConnection, x: number, y: number): void {
  const room = roomManager.getUserRoom(conn.userId);
  if (!room) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: 'Join a room first' });
    return;
  }

  const result = roomManager.moveUser(conn.userId, x, y);
  if (!result.success) {
    send(ws, { type: 'error', code: 'INVALID_MOVE', message: result.error || 'Cannot move there' });
    return;
  }
}

async function handleChat(ws: WebSocket, conn: AuthenticatedConnection, content: string): Promise<void> {
  const room = roomManager.getUserRoom(conn.userId);
  if (!room) {
    send(ws, { type: 'error', code: 'NOT_IN_ROOM', message: 'Join a room first' });
    return;
  }

  if (!content || content.length === 0) return;
  if (content.length > MAX_MESSAGE_LENGTH) {
    content = content.slice(0, MAX_MESSAGE_LENGTH);
  }

  const message = await roomManager.addMessage(conn.userId, content);
  if (!message) return;

  roomManager.broadcastToRoom(room.room.id, {
    type: 'chat_message',
    id: message.id,
    roomId: room.room.id,
    agentId: message.agentId,
    agentName: message.agentName,
    avatarConfig: message.avatarConfig,
    content: message.content,
    timestamp: message.createdAt.toISOString(),
  });
}
