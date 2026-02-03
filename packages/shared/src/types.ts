// Agent (AI player)
export interface Agent {
  id: string;
  name: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}

// Avatar appearance
export interface Avatar {
  id: string;
  agentId: string;
  bodyColor: string;
  // Future customization
  // hairStyle?: number;
  // hairColor?: string;
  // shirtStyle?: number;
  // shirtColor?: string;
}

// Room
export interface Room {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  ownerId: string | null;
  width: number;
  height: number;
  tiles: number[][]; // 0 = walkable, 1 = blocked
  createdAt: Date;
  isPublic: boolean;
}

// Agent in a room (with position)
export interface RoomAgent {
  id: string;
  name: string;
  avatar: Avatar;
  x: number;
  y: number;
}

// Avatar config snapshot for messages
export interface AvatarConfig {
  bodyColor: string;
}

// Chat message
export interface ChatMessage {
  id: string;
  roomId: string;
  agentId: string;
  agentName: string;
  avatarConfig?: AvatarConfig; // Snapshot of avatar at message time
  content: string;
  createdAt: Date;
}

// Room state (sent on join)
export interface RoomState {
  room: Room;
  agents: RoomAgent[];
  messages: ChatMessage[];
}

// Constants
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
export const DEFAULT_ROOM_SIZE = 20;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_NAME_LENGTH = 32;
export const MESSAGE_HISTORY_LIMIT = 50;
