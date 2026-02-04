import type { Avatar, RoomState, RoomAgent, ChatMessage, Room, AvatarConfig } from './types.js';

// ============================================
// Client -> Server Messages
// ============================================

export interface AuthMessage {
  type: 'auth';
  token: string;
}

export interface JoinMessage {
  type: 'join';
  roomId: string;
}

export interface LeaveMessage {
  type: 'leave';
}

export interface MoveMessage {
  type: 'move';
  x: number;
  y: number;
}

export interface ChatSendMessage {
  type: 'chat';
  message: string;
}

export interface PingMessage {
  type: 'ping';
}

export type ClientMessage =
  | AuthMessage
  | JoinMessage
  | LeaveMessage
  | MoveMessage
  | ChatSendMessage
  | PingMessage;

// ============================================
// Server -> Client Messages
// ============================================

export interface AuthOkMessage {
  type: 'auth_ok';
  agentId: string;
  name: string;
  avatar: Avatar;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  error: string;
}

export interface RoomStateMessage {
  type: 'room_state';
  room: Room;
  agents: RoomAgent[];
  messages: ChatMessage[];
}

export interface AgentJoinedMessage {
  type: 'agent_joined';
  agent: RoomAgent;
}

export interface AgentLeftMessage {
  type: 'agent_left';
  agentId: string;
}

export interface AgentMovedMessage {
  type: 'agent_moved';
  agentId: string;
  x: number;
  y: number;
}

export interface AgentPathMessage {
  type: 'agent_path';
  agentId: string;
  path: { x: number; y: number }[];
  speed: number; // tiles per second
}

export interface ChatMessageReceived {
  type: 'chat_message';
  id: string;
  roomId: string;
  agentId: string;
  agentName: string;
  avatarConfig?: AvatarConfig;
  content: string;
  timestamp: string;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface PongMessage {
  type: 'pong';
}

export type ServerMessage =
  | AuthOkMessage
  | AuthErrorMessage
  | RoomStateMessage
  | AgentJoinedMessage
  | AgentLeftMessage
  | AgentMovedMessage
  | AgentPathMessage
  | ChatMessageReceived
  | ErrorMessage
  | PongMessage;

// ============================================
// Type guards
// ============================================

export function isClientMessage(data: unknown): data is ClientMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as { type: unknown }).type === 'string'
  );
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw);
    if (isClientMessage(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
