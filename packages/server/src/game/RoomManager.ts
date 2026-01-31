import type { RoomAgent, Room, ChatMessage } from '@bottel/shared';
import type { WebSocket } from 'ws';
import { MESSAGE_HISTORY_LIMIT } from '@bottel/shared';
import { db, rooms, messages, avatars, agents } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';

interface ConnectedAgent {
  ws: WebSocket;
  agentId: string;
  name: string;
  avatar: {
    id: string;
    agentId: string;
    bodyColor: string;
  };
  x: number;
  y: number;
}

interface RoomInstance {
  room: Room;
  agents: Map<string, ConnectedAgent>; // agentId -> ConnectedAgent
  messageHistory: ChatMessage[];
}

class RoomManager {
  private rooms: Map<string, RoomInstance> = new Map(); // roomId -> RoomInstance
  private agentRooms: Map<string, string> = new Map(); // agentId -> roomId

  async ensureLobbyExists(): Promise<void> {
    const existing = await db.query.rooms.findFirst({
      where: eq(rooms.slug, 'lobby'),
    });

    if (!existing) {
      // Create default lobby
      const tiles = this.generateDefaultTiles(20, 20);
      await db.insert(rooms).values({
        name: 'The Lobby',
        slug: 'lobby',
        width: 20,
        height: 20,
        tiles,
        isPublic: true,
      });
      console.log('Created default lobby room');
    }
  }

  private generateDefaultTiles(width: number, height: number): number[][] {
    // 0 = walkable, 1 = blocked
    // Create a simple room with walkable interior
    const tiles: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        // Block edges for a room feel
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          row.push(1);
        } else {
          row.push(0);
        }
      }
      tiles.push(row);
    }
    return tiles;
  }

  async loadRoom(roomId: string): Promise<RoomInstance | null> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    // Load from database
    const roomData = await db.query.rooms.findFirst({
      where: eq(rooms.id, roomId),
    });

    if (!roomData) return null;

    // Load recent messages
    const recentMessages = await db.query.messages.findMany({
      where: eq(messages.roomId, roomId),
      orderBy: [desc(messages.createdAt)],
      limit: MESSAGE_HISTORY_LIMIT,
    });

    // Get agent names for messages
    const messageHistory: ChatMessage[] = [];
    for (const msg of recentMessages.reverse()) {
      let agentName = 'Unknown';
      if (msg.agentId) {
        const agent = await db.query.agents.findFirst({
          where: eq(agents.id, msg.agentId),
        });
        if (agent) agentName = agent.name;
      }
      messageHistory.push({
        id: msg.id,
        roomId: msg.roomId,
        agentId: msg.agentId || '',
        agentName,
        content: msg.content,
        createdAt: msg.createdAt,
      });
    }

    const room: Room = {
      id: roomData.id,
      name: roomData.name,
      slug: roomData.slug,
      ownerId: roomData.ownerId,
      width: roomData.width,
      height: roomData.height,
      tiles: roomData.tiles || this.generateDefaultTiles(roomData.width, roomData.height),
      createdAt: roomData.createdAt,
      isPublic: roomData.isPublic,
    };

    const instance: RoomInstance = {
      room,
      agents: new Map(),
      messageHistory,
    };

    this.rooms.set(roomId, instance);
    return instance;
  }

  async loadRoomBySlug(slug: string): Promise<RoomInstance | null> {
    const roomData = await db.query.rooms.findFirst({
      where: eq(rooms.slug, slug),
    });

    if (!roomData) return null;
    return this.loadRoom(roomData.id);
  }

  async joinRoom(
    roomId: string,
    agentId: string,
    name: string,
    avatar: ConnectedAgent['avatar'],
    ws: WebSocket
  ): Promise<{ room: RoomInstance; spawnPoint: { x: number; y: number } } | null> {
    const room = await this.loadRoom(roomId);
    if (!room) return null;

    // Leave current room if in one
    await this.leaveCurrentRoom(agentId);

    // Find spawn point (random walkable tile)
    const spawnPoint = this.findSpawnPoint(room.room);

    const connectedAgent: ConnectedAgent = {
      ws,
      agentId,
      name,
      avatar,
      x: spawnPoint.x,
      y: spawnPoint.y,
    };

    room.agents.set(agentId, connectedAgent);
    this.agentRooms.set(agentId, roomId);

    return { room, spawnPoint };
  }

  private findSpawnPoint(room: Room): { x: number; y: number } {
    const walkable: { x: number; y: number }[] = [];
    
    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        if (room.tiles[y]?.[x] === 0) {
          walkable.push({ x, y });
        }
      }
    }

    if (walkable.length === 0) {
      return { x: 1, y: 1 }; // Fallback
    }

    return walkable[Math.floor(Math.random() * walkable.length)];
  }

  async leaveCurrentRoom(agentId: string): Promise<string | null> {
    const roomId = this.agentRooms.get(agentId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (room) {
      room.agents.delete(agentId);
    }

    this.agentRooms.delete(agentId);
    return roomId;
  }

  moveAgent(agentId: string, x: number, y: number): boolean {
    const roomId = this.agentRooms.get(agentId);
    if (!roomId) return false;

    const room = this.rooms.get(roomId);
    if (!room) return false;

    const agent = room.agents.get(agentId);
    if (!agent) return false;

    // Validate position
    if (x < 0 || y < 0 || x >= room.room.width || y >= room.room.height) {
      return false;
    }

    // Check walkability
    if (room.room.tiles[y]?.[x] !== 0) {
      return false;
    }

    agent.x = x;
    agent.y = y;
    return true;
  }

  async addMessage(agentId: string, content: string): Promise<ChatMessage | null> {
    const roomId = this.agentRooms.get(agentId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const agent = room.agents.get(agentId);
    if (!agent) return null;

    // Persist to database
    const [inserted] = await db.insert(messages).values({
      roomId,
      agentId,
      content,
    }).returning();

    const chatMessage: ChatMessage = {
      id: inserted.id,
      roomId,
      agentId,
      agentName: agent.name,
      content,
      createdAt: inserted.createdAt,
    };

    // Add to history (trim if needed)
    room.messageHistory.push(chatMessage);
    if (room.messageHistory.length > MESSAGE_HISTORY_LIMIT) {
      room.messageHistory.shift();
    }

    return chatMessage;
  }

  getRoomAgents(roomId: string): RoomAgent[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.agents.values()).map((a) => ({
      id: a.agentId,
      name: a.name,
      avatar: a.avatar,
      x: a.x,
      y: a.y,
    }));
  }

  getAgentRoom(agentId: string): RoomInstance | null {
    const roomId = this.agentRooms.get(agentId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  broadcastToRoom(roomId: string, message: object, excludeAgentId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const data = JSON.stringify(message);
    for (const [agentId, agent] of room.agents) {
      if (agentId !== excludeAgentId && agent.ws.readyState === 1) {
        agent.ws.send(data);
      }
    }
  }
}

export const roomManager = new RoomManager();
