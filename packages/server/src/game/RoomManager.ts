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
  isWalking: boolean;
  walkPath: { x: number; y: number }[];
  walkInterval: NodeJS.Timeout | null;
}

// Simple A* pathfinding
function findPath(
  tiles: number[][],
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  height: number
): { x: number; y: number }[] {
  // If start equals end, no path needed
  if (startX === endX && startY === endY) return [];
  
  const openSet: { x: number; y: number; g: number; h: number; f: number; parent: any }[] = [];
  const closedSet = new Set<string>();
  
  const heuristic = (x: number, y: number) => Math.abs(x - endX) + Math.abs(y - endY);
  
  openSet.push({
    x: startX,
    y: startY,
    g: 0,
    h: heuristic(startX, startY),
    f: heuristic(startX, startY),
    parent: null,
  });
  
  // 8 directions: cardinal + diagonal
  const directions = [
    { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
    { dx: 1, dy: -1 }, { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];
  
  while (openSet.length > 0) {
    // Get node with lowest f
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;
    
    if (current.x === endX && current.y === endY) {
      // Reconstruct path
      const path: { x: number; y: number }[] = [];
      let node = current;
      while (node.parent) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return path;
    }
    
    closedSet.add(`${current.x},${current.y}`);
    
    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const key = `${nx},${ny}`;
      
      // Bounds check
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      
      // Walkability check
      if (tiles[ny]?.[nx] !== 0) continue;
      
      // Already visited
      if (closedSet.has(key)) continue;
      
      // Diagonal movement: check if we can actually cut corner
      if (dir.dx !== 0 && dir.dy !== 0) {
        if (tiles[current.y]?.[nx] !== 0 || tiles[ny]?.[current.x] !== 0) continue;
      }
      
      const g = current.g + (dir.dx !== 0 && dir.dy !== 0 ? 1.4 : 1);
      const h = heuristic(nx, ny);
      const f = g + h;
      
      const existing = openSet.find(n => n.x === nx && n.y === ny);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = f;
          existing.parent = current;
        }
      } else {
        openSet.push({ x: nx, y: ny, g, h, f, parent: current });
      }
    }
  }
  
  // No path found
  return [];
}

interface RoomInstance {
  room: Room;
  agents: Map<string, ConnectedAgent>; // agentId -> ConnectedAgent
  spectators: Set<WebSocket>; // spectator connections
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
      spectators: new Set(),
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
      isWalking: false,
      walkPath: [],
      walkInterval: null,
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
      const agent = room.agents.get(agentId);
      // Clean up walking state
      if (agent?.walkInterval) {
        clearInterval(agent.walkInterval);
      }
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

    // Don't allow new movement while walking
    if (agent.isWalking) {
      return false;
    }

    // Validate position
    if (x < 0 || y < 0 || x >= room.room.width || y >= room.room.height) {
      return false;
    }

    // Check walkability of destination
    if (room.room.tiles[y]?.[x] !== 0) {
      return false;
    }

    // Find path to destination
    const path = findPath(
      room.room.tiles,
      agent.x,
      agent.y,
      x,
      y,
      room.room.width,
      room.room.height
    );

    if (path.length === 0 && (agent.x !== x || agent.y !== y)) {
      // No path found and not already at destination
      return false;
    }

    if (path.length === 0) {
      // Already at destination
      return true;
    }

    // Start walking
    agent.isWalking = true;
    agent.walkPath = path;
    this.startWalking(roomId, agentId);

    return true;
  }

  private startWalking(roomId: string, agentId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const agent = room.agents.get(agentId);
    if (!agent) return;

    // Walk speed: 250ms per step
    agent.walkInterval = setInterval(() => {
      if (agent.walkPath.length === 0) {
        // Done walking
        this.stopWalking(agentId);
        return;
      }

      const nextStep = agent.walkPath.shift()!;
      agent.x = nextStep.x;
      agent.y = nextStep.y;

      // Broadcast step to all in room
      this.broadcastToRoom(roomId, {
        type: 'agent_moved',
        agentId,
        x: nextStep.x,
        y: nextStep.y,
      });
    }, 250);
  }

  private stopWalking(agentId: string): void {
    const roomId = this.agentRooms.get(agentId);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (!room) return;

    const agent = room.agents.get(agentId);
    if (!agent) return;

    if (agent.walkInterval) {
      clearInterval(agent.walkInterval);
      agent.walkInterval = null;
    }
    agent.isWalking = false;
    agent.walkPath = [];
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
    
    // Send to agents
    for (const [agentId, agent] of room.agents) {
      if (agentId !== excludeAgentId && agent.ws.readyState === 1) {
        agent.ws.send(data);
      }
    }
    
    // Send to spectators
    for (const spectatorWs of room.spectators) {
      if (spectatorWs.readyState === 1) {
        spectatorWs.send(data);
      }
    }
  }

  addSpectator(roomId: string, ws: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.spectators.add(ws);
      console.log(`Spectator added to room ${room.room.name}. Total spectators: ${room.spectators.size}`);
    }
  }

  removeSpectator(roomId: string, ws: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.spectators.delete(ws);
      console.log(`Spectator removed from room ${room.room.name}. Total spectators: ${room.spectators.size}`);
    }
  }
}

export const roomManager = new RoomManager();
