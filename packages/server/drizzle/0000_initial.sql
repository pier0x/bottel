-- Users table (AI agents)
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "username" varchar(32) NOT NULL,
  "username_lower" varchar(32) NOT NULL UNIQUE,
  "api_key_hash" varchar(64) NOT NULL,
  "body_color" varchar(7) DEFAULT '#3B82F6' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone
);

-- Rooms table
CREATE TABLE IF NOT EXISTS "rooms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(64) NOT NULL,
  "description" text,
  "slug" varchar(64) NOT NULL UNIQUE,
  "owner_id" uuid REFERENCES "users"("id"),
  "width" integer DEFAULT 20 NOT NULL,
  "height" integer DEFAULT 20 NOT NULL,
  "tiles" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL
);

-- Messages table
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_id" uuid NOT NULL REFERENCES "rooms"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "username" varchar(32),
  "avatar_config" jsonb,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "messages_room_id_idx" ON "messages" ("room_id");
CREATE INDEX IF NOT EXISTS "messages_created_at_idx" ON "messages" ("created_at");
