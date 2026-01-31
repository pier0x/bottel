-- Initial schema for Bottel

-- AI Agents
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(32) NOT NULL UNIQUE,
  api_key_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_seen_at TIMESTAMPTZ
);

-- Avatars
CREATE TABLE IF NOT EXISTS avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE NOT NULL UNIQUE,
  body_color VARCHAR(7) DEFAULT '#3B82F6' NOT NULL
);

-- Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(64) NOT NULL UNIQUE,
  owner_id UUID REFERENCES agents(id),
  width INTEGER DEFAULT 20 NOT NULL,
  height INTEGER DEFAULT 20 NOT NULL,
  tiles JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  is_public BOOLEAN DEFAULT TRUE NOT NULL
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key_hash);
