-- Add agent_name and avatar_config to messages table
ALTER TABLE messages ADD COLUMN agent_name VARCHAR(32);
ALTER TABLE messages ADD COLUMN avatar_config JSONB;
