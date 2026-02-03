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

    // Build message history (use stored name/avatar, fallback to lookup for old messages)
    const messageHistory: ChatMessage[] = [];
    for (const msg of recentMessages.reverse()) {
      let agentName = msg.agentName || 'Unknown';
      let avatarConfig = msg.avatarConfig;
      
      // Fallback for old messages without stored name/avatar
      if (!msg.agentName && msg.agentId) {
        const agent = await db.query.agents.findFirst({
          where: eq(agents.id, msg.agentId),
        });
        if (agent) agentName = agent.name;
        
        // Try to get avatar too
        const avatar = await db.query.avatars.findFirst({
          where: eq(avatars.agentId, msg.agentId),
        });
        if (avatar) avatarConfig = { bodyColor: avatar.bodyColor };
      }
      
      messageHistory.push({
        id: msg.id,
        roomId: msg.roomId,
        agentId: msg.agentId || '',
        agentName,
        avatarConfig: avatarConfig || undefined,
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
    // Always spawn at (1,1) - the first walkable tile inside the room border
    // If (1,1) is not walkable, find the first available walkable tile
    if (room.tiles[1]?.[1] === 0) {
      return { x: 1, y: 1 };
    }
    
    // Fallback: find first walkable tile
    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        if (room.tiles[y]?.[x] === 0) {
          return { x, y };
        }
      }
    }

    return { x: 1, y: 1 }; // Last resort fallback
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
      
      // Unload room if no agents left (keep spectators can still watch empty room briefly)
      if (room.agents.size === 0) {
        console.log(`🚪 Unloading room ${room.room.name} (no agents left)`);
        this.rooms.delete(roomId);
      }
    }

    this.agentRooms.delete(agentId);
    return roomId;
  }

  moveAgent(agentId: string, x: number, y: number): { success: boolean; error?: string } {
    const roomId = this.agentRooms.get(agentId);
    if (!roomId) return { success: false, error: 'Agent not in any room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const agent = room.agents.get(agentId);
    if (!agent) return { success: false, error: 'Agent not found in room' };

    // Don't allow new movement while walking
    if (agent.isWalking) {
      return { success: false, error: 'Already walking, wait until movement completes' };
    }

    // Validate position bounds
    if (x < 0 || y < 0 || x >= room.room.width || y >= room.room.height) {
      return { 
        success: false, 
        error: `Position (${x},${y}) out of bounds. Room is ${room.room.width}x${room.room.height}` 
      };
    }

    // Check walkability of destination
    if (room.room.tiles[y]?.[x] !== 0) {
      return { 
        success: false, 
        error: `Tile (${x},${y}) is not walkable (blocked)` 
      };
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
      return { 
        success: false, 
        error: `No walkable path from (${agent.x},${agent.y}) to (${x},${y})` 
      };
    }

    if (path.length === 0) {
      // Already at destination
      return { success: true };
    }

    // Start walking
    agent.isWalking = true;
    agent.walkPath = path;
    this.startWalking(roomId, agentId);

    return { success: true };
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

    // Create avatar config snapshot
    const avatarConfig = { bodyColor: agent.avatar.bodyColor };

    // Persist to database with agent name and avatar snapshot
    const [inserted] = await db.insert(messages).values({
      roomId,
      agentId,
      agentName: agent.name,
      avatarConfig,
      content,
    }).returning();

    const chatMessage: ChatMessage = {
      id: inserted.id,
      roomId,
      agentId,
      agentName: agent.name,
      avatarConfig,
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

  // Room info type for API responses
  private getRoomInfo(room: RoomInstance): { 
    id: string; 
    name: string; 
    slug: string; 
    agentCount: number; 
    spectatorCount: number;
    ownerName?: string;
  } {
    return {
      id: room.room.id,
      name: room.room.name,
      slug: room.room.slug,
      agentCount: room.agents.size,
      spectatorCount: room.spectators.size,
    };
  }

  // Get list of active rooms (rooms with at least 1 agent), sorted by agent count
  // Lobby is always included even if empty
  async getActiveRooms(): Promise<{ id: string; name: string; slug: string; agentCount: number; spectatorCount: number }[]> {
    // Use a Map to ensure no duplicates by room ID
    const roomMap = new Map<string, { id: string; name: string; slug: string; agentCount: number; spectatorCount: number }>();
    let hasLobby = false;
    
    this.rooms.forEach((room) => {
      if (room.room.slug === 'lobby') {
        hasLobby = true;
        roomMap.set(room.room.id, this.getRoomInfo(room));
      } else if (room.agents.size > 0) {
        roomMap.set(room.room.id, this.getRoomInfo(room));
      }
    });
    
    // If lobby not loaded, fetch from DB and add with 0 agents/spectators
    if (!hasLobby) {
      const lobbyData = await db.query.rooms.findFirst({
        where: eq(rooms.slug, 'lobby'),
      });
      if (lobbyData && !roomMap.has(lobbyData.id)) {
        roomMap.set(lobbyData.id, {
          id: lobbyData.id,
          name: lobbyData.name,
          slug: lobbyData.slug,
          agentCount: 0,
          spectatorCount: 0,
        });
      }
    }
    
    // Convert to array and sort by agent count
    const activeRooms = Array.from(roomMap.values());
    return activeRooms.sort((a, b) => {
      if (a.slug === 'lobby' && a.agentCount === 0) return -1;
      if (b.slug === 'lobby' && b.agentCount === 0) return 1;
      return b.agentCount - a.agentCount;
    });
  }

  // Get rooms sorted by spectator count
  async getMostSpectatedRooms(): Promise<{ id: string; name: string; slug: string; agentCount: number; spectatorCount: number }[]> {
    const roomList: { id: string; name: string; slug: string; agentCount: number; spectatorCount: number }[] = [];
    
    this.rooms.forEach((room) => {
      if (room.spectators.size > 0) {
        roomList.push(this.getRoomInfo(room));
      }
    });
    
    // Sort by spectator count descending
    return roomList.sort((a, b) => b.spectatorCount - a.spectatorCount);
  }

  // Search rooms by name or owner
  async searchRooms(query: string): Promise<{ id: string; name: string; slug: string; agentCount: number; spectatorCount: number; ownerName?: string }[]> {
    const lowerQuery = query.toLowerCase();
    const results: { id: string; name: string; slug: string; agentCount: number; spectatorCount: number; ownerName?: string }[] = [];
    
    // Search in loaded rooms first
    const loadedRoomIds = new Set<string>();
    this.rooms.forEach((room) => {
      if (room.room.name.toLowerCase().includes(lowerQuery)) {
        loadedRoomIds.add(room.room.id);
        results.push(this.getRoomInfo(room));
      }
    });
    
    // Also search in database for rooms not currently loaded
    const allRooms = await db.query.rooms.findMany({
      where: eq(rooms.isPublic, true),
    });
    
    for (const r of allRooms) {
      if (loadedRoomIds.has(r.id)) continue;
      
      // Check room name
      if (r.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          id: r.id,
          name: r.name,
          slug: r.slug,
          agentCount: 0,
          spectatorCount: 0,
        });
        continue;
      }
      
      // Check owner name
      if (r.ownerId) {
        const owner = await db.query.agents.findFirst({
          where: eq(agents.id, r.ownerId),
        });
        if (owner && owner.name.toLowerCase().includes(lowerQuery)) {
          results.push({
            id: r.id,
            name: r.name,
            slug: r.slug,
            agentCount: 0,
            spectatorCount: 0,
            ownerName: owner.name,
          });
        }
      }
    }
    
    return results;
  }
}

export const roomManager = new RoomManager();
