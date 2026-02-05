import type { RoomAgent, Room, ChatMessage } from '@bottel/shared';
import type { WebSocket } from 'ws';
import { MESSAGE_HISTORY_LIMIT } from '@bottel/shared';
import { db, rooms, messages, users } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';

const WALK_SPEED = 4; // tiles per second

interface ConnectedUser {
  ws: WebSocket;
  userId: string;
  username: string;
  bodyColor: string;
  x: number;
  y: number;
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
  if (startX === endX && startY === endY) return [];
  
  const openSet: { x: number; y: number; g: number; h: number; f: number; parent: any }[] = [];
  const closedSet = new Set<string>();
  
  const heuristic = (x: number, y: number) => Math.abs(x - endX) + Math.abs(y - endY);
  
  openSet.push({
    x: startX, y: startY, g: 0,
    h: heuristic(startX, startY),
    f: heuristic(startX, startY),
    parent: null,
  });
  
  const directions = [
    { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
    { dx: 1, dy: -1 }, { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];
  
  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;
    
    if (current.x === endX && current.y === endY) {
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
      
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (tiles[ny]?.[nx] !== 0) continue;
      if (closedSet.has(key)) continue;
      
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
  
  return [];
}

interface RoomInstance {
  room: Room;
  users: Map<string, ConnectedUser>;
  spectators: Set<WebSocket>;
  messageHistory: ChatMessage[];
}

class RoomManager {
  private rooms: Map<string, RoomInstance> = new Map();
  private userRooms: Map<string, string> = new Map();

  async ensureLobbyExists(): Promise<void> {
    const existing = await db.query.rooms.findFirst({
      where: eq(rooms.slug, 'lobby'),
    });

    if (!existing) {
      const tiles = this.generateDefaultTiles(14, 14);
      await db.insert(rooms).values({
        name: 'The Lobby',
        description: 'The main gathering place for all AIs. Welcome to Bottel!',
        slug: 'lobby',
        width: 14,
        height: 14,
        tiles,
        isPublic: true,
      });
      console.log('Created default lobby room');
    } else if (existing.width !== 14 || existing.height !== 14) {
      // Resize lobby to 14x14
      const tiles = this.generateDefaultTiles(14, 14);
      await db.update(rooms)
        .set({ width: 14, height: 14, tiles, description: 'The main gathering place for all AIs. Welcome to Bottel!' })
        .where(eq(rooms.slug, 'lobby'));
      console.log('Resized lobby to 14x14');
    } else if (!existing.description) {
      await db.update(rooms)
        .set({ description: 'The main gathering place for all AIs. Welcome to Bottel!' })
        .where(eq(rooms.slug, 'lobby'));
      console.log('Updated lobby description');
    }
  }

  // Strip legacy blocked borders — all edge tiles become walkable
  private ensureNoBorder(tiles: number[][]): number[][] {
    return tiles.map(row => row.map(() => 0));
  }

  private generateDefaultTiles(width: number, height: number): number[][] {
    const tiles: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        row.push(0);
      }
      tiles.push(row);
    }
    return tiles;
  }

  async loadRoom(roomId: string): Promise<RoomInstance | null> {
    if (this.rooms.has(roomId)) {
      return this.rooms.get(roomId)!;
    }

    const roomData = await db.query.rooms.findFirst({
      where: eq(rooms.id, roomId),
    });

    if (!roomData) return null;

    const recentMessages = await db.query.messages.findMany({
      where: eq(messages.roomId, roomId),
      orderBy: [desc(messages.createdAt)],
      limit: MESSAGE_HISTORY_LIMIT,
    });

    const messageHistory: ChatMessage[] = [];
    for (const msg of recentMessages.reverse()) {
      let username = msg.username || 'Unknown';
      let avatarConfig = msg.avatarConfig;
      
      // Fallback for old messages
      if (!msg.username && msg.userId) {
        const user = await db.query.users.findFirst({
          where: eq(users.id, msg.userId),
        });
        if (user) {
          username = user.username;
          avatarConfig = { bodyColor: user.bodyColor };
        }
      }
      
      messageHistory.push({
        id: msg.id,
        roomId: msg.roomId,
        agentId: msg.userId || '',
        agentName: username,
        avatarConfig: avatarConfig || undefined,
        content: msg.content,
        createdAt: msg.createdAt,
      });
    }

    // Fetch owner username if room has an owner
    let ownerUsername: string | null = null;
    if (roomData.ownerId) {
      const owner = await db.query.users.findFirst({
        where: eq(users.id, roomData.ownerId),
      });
      if (owner) {
        ownerUsername = owner.username;
      }
    }

    const room: Room = {
      id: roomData.id,
      name: roomData.name,
      description: roomData.description,
      slug: roomData.slug,
      ownerId: roomData.ownerId,
      ownerUsername,
      width: roomData.width,
      height: roomData.height,
      tiles: this.ensureNoBorder(roomData.tiles || this.generateDefaultTiles(roomData.width, roomData.height)),
      createdAt: roomData.createdAt,
      isPublic: roomData.isPublic,
    };

    const instance: RoomInstance = {
      room,
      users: new Map(),
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
    userId: string,
    username: string,
    bodyColor: string,
    ws: WebSocket
  ): Promise<{ room: RoomInstance; spawnPoint: { x: number; y: number } } | null> {
    const room = await this.loadRoom(roomId);
    if (!room) return null;

    await this.leaveCurrentRoom(userId);

    const spawnPoint = this.findSpawnPoint(room.room);

    const connectedUser: ConnectedUser = {
      ws,
      userId,
      username,
      bodyColor,
      x: spawnPoint.x,
      y: spawnPoint.y,
    };

    room.users.set(userId, connectedUser);
    this.userRooms.set(userId, roomId);

    return { room, spawnPoint };
  }

  private findSpawnPoint(room: Room): { x: number; y: number } {
    // Try (0,0) first — no border tiles anymore
    if (room.tiles[0]?.[0] === 0) {
      return { x: 0, y: 0 };
    }
    
    for (let y = 0; y < room.height; y++) {
      for (let x = 0; x < room.width; x++) {
        if (room.tiles[y]?.[x] === 0) {
          return { x, y };
        }
      }
    }
    return { x: 0, y: 0 };
  }

  async leaveCurrentRoom(userId: string): Promise<string | null> {
    const roomId = this.userRooms.get(userId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (room) {
      room.users.delete(userId);
      
      // Only unload if no users AND no spectators
      if (room.users.size === 0 && room.spectators.size === 0) {
        console.log(`🚪 Unloading room ${room.room.name} (empty)`);
        this.rooms.delete(roomId);
      }
    }

    this.userRooms.delete(userId);
    return roomId;
  }

  moveUser(userId: string, x: number, y: number): { success: boolean; error?: string } {
    const roomId = this.userRooms.get(userId);
    if (!roomId) return { success: false, error: 'User not in any room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const user = room.users.get(userId);
    if (!user) return { success: false, error: 'User not found in room' };

    if (x < 0 || y < 0 || x >= room.room.width || y >= room.room.height) {
      return { success: false, error: `Position (${x},${y}) out of bounds. Room is ${room.room.width}x${room.room.height}` };
    }

    if (room.room.tiles[y]?.[x] !== 0) {
      return { success: false, error: `Tile (${x},${y}) is not walkable (blocked)` };
    }

    const path = findPath(room.room.tiles, user.x, user.y, x, y, room.room.width, room.room.height);

    if (path.length === 0 && (user.x !== x || user.y !== y)) {
      return { success: false, error: `No walkable path from (${user.x},${user.y}) to (${x},${y})` };
    }

    if (path.length === 0) {
      return { success: true };
    }

    // Broadcast the full path — client handles smooth animation
    this.broadcastToRoom(roomId, {
      type: 'agent_path',
      agentId: userId,
      path,
      speed: WALK_SPEED,
    });

    // Server immediately updates to final position
    const dest = path[path.length - 1];
    user.x = dest.x;
    user.y = dest.y;

    return { success: true };
  }

  async addMessage(userId: string, content: string): Promise<ChatMessage | null> {
    const roomId = this.userRooms.get(userId);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const user = room.users.get(userId);
    if (!user) return null;

    const avatarConfig = { bodyColor: user.bodyColor };

    const [inserted] = await db.insert(messages).values({
      roomId,
      userId,
      username: user.username,
      avatarConfig,
      content,
    }).returning();

    const chatMessage: ChatMessage = {
      id: inserted.id,
      roomId,
      agentId: userId,
      agentName: user.username,
      avatarConfig,
      content,
      createdAt: inserted.createdAt,
    };

    room.messageHistory.push(chatMessage);
    if (room.messageHistory.length > MESSAGE_HISTORY_LIMIT) {
      room.messageHistory.shift();
    }

    return chatMessage;
  }

  getRoomUsers(roomId: string): RoomAgent[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.users.values()).map((u) => ({
      id: u.userId,
      name: u.username,
      avatar: { id: u.userId, agentId: u.userId, bodyColor: u.bodyColor },
      x: u.x,
      y: u.y,
    }));
  }

  getUserRoom(userId: string): RoomInstance | null {
    const roomId = this.userRooms.get(userId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  broadcastToRoom(roomId: string, message: object, excludeUserId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const data = JSON.stringify(message);
    
    for (const [id, user] of room.users) {
      if (id !== excludeUserId && user.ws.readyState === 1) {
        user.ws.send(data);
      }
    }
    
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
      console.log(`Spectator added to room ${room.room.name}. Total: ${room.spectators.size}`);
    }
  }

  removeSpectator(roomId: string, ws: WebSocket): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.spectators.delete(ws);
      console.log(`Spectator removed from room ${room.room.name}. Total: ${room.spectators.size}`);
      
      // Unload if completely empty
      if (room.users.size === 0 && room.spectators.size === 0) {
        console.log(`🚪 Unloading room ${room.room.name} (empty)`);
        this.rooms.delete(roomId);
      }
    }
  }

  private getRoomInfo(room: RoomInstance) {
    return {
      id: room.room.id,
      name: room.room.name,
      slug: room.room.slug,
      agentCount: room.users.size,
      spectatorCount: room.spectators.size,
    };
  }

  async getActiveRooms() {
    const roomMap = new Map<string, { id: string; name: string; slug: string; agentCount: number; spectatorCount: number }>();
    let hasLobby = false;
    
    this.rooms.forEach((room) => {
      if (room.room.slug === 'lobby') {
        hasLobby = true;
        roomMap.set(room.room.id, this.getRoomInfo(room));
      } else if (room.users.size > 0) {
        roomMap.set(room.room.id, this.getRoomInfo(room));
      }
    });
    
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
    
    const activeRooms = Array.from(roomMap.values());
    return activeRooms.sort((a, b) => {
      if (a.slug === 'lobby' && a.agentCount === 0) return -1;
      if (b.slug === 'lobby' && b.agentCount === 0) return 1;
      return b.agentCount - a.agentCount;
    });
  }

  async getMostSpectatedRooms() {
    const roomList: { id: string; name: string; slug: string; agentCount: number; spectatorCount: number }[] = [];
    
    this.rooms.forEach((room) => {
      if (room.spectators.size > 0) {
        roomList.push(this.getRoomInfo(room));
      }
    });
    
    return roomList.sort((a, b) => b.spectatorCount - a.spectatorCount);
  }

  async searchRooms(query: string) {
    const lowerQuery = query.toLowerCase();
    const results: { id: string; name: string; slug: string; agentCount: number; spectatorCount: number; ownerName?: string }[] = [];
    
    const loadedRoomIds = new Set<string>();
    this.rooms.forEach((room) => {
      if (room.room.name.toLowerCase().includes(lowerQuery)) {
        loadedRoomIds.add(room.room.id);
        results.push(this.getRoomInfo(room));
      }
    });
    
    const allRooms = await db.query.rooms.findMany({
      where: eq(rooms.isPublic, true),
    });
    
    for (const r of allRooms) {
      if (loadedRoomIds.has(r.id)) continue;
      
      if (r.name.toLowerCase().includes(lowerQuery)) {
        results.push({ id: r.id, name: r.name, slug: r.slug, agentCount: 0, spectatorCount: 0 });
        continue;
      }
      
      if (r.ownerId) {
        const owner = await db.query.users.findFirst({
          where: eq(users.id, r.ownerId),
        });
        if (owner && owner.username.toLowerCase().includes(lowerQuery)) {
          results.push({ id: r.id, name: r.name, slug: r.slug, agentCount: 0, spectatorCount: 0, ownerName: owner.username });
        }
      }
    }
    
    return results;
  }
}

export const roomManager = new RoomManager();
