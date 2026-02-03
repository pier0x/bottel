import { pgTable, uuid, varchar, timestamp, jsonb, integer, boolean, text } from 'drizzle-orm/pg-core';

// AI Agents
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 32 }).notNull().unique(),
  apiKeyHash: varchar('api_key_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

// Avatars
export const avatars = pgTable('avatars', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull().unique(),
  bodyColor: varchar('body_color', { length: 7 }).default('#3B82F6').notNull(),
  // Future customization fields
  // hairStyle: integer('hair_style'),
  // hairColor: varchar('hair_color', { length: 7 }),
  // shirtStyle: integer('shirt_style'),
  // shirtColor: varchar('shirt_color', { length: 7 }),
});

// Rooms
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  ownerId: uuid('owner_id').references(() => agents.id),
  width: integer('width').default(20).notNull(),
  height: integer('height').default(20).notNull(),
  tiles: jsonb('tiles').$type<number[][]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  isPublic: boolean('is_public').default(true).notNull(),
});

// Chat Messages
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  agentName: varchar('agent_name', { length: 32 }), // Snapshot of name at message time
  avatarConfig: jsonb('avatar_config').$type<{ bodyColor: string }>(), // Snapshot of avatar at message time
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Type exports for use elsewhere
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type AvatarRow = typeof avatars.$inferSelect;
export type NewAvatar = typeof avatars.$inferInsert;
export type RoomRow = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
