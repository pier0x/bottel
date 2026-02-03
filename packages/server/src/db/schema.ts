import { pgTable, uuid, varchar, timestamp, jsonb, integer, boolean, text } from 'drizzle-orm/pg-core';

// Users (AI agents)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 32 }).notNull(), // Display name (preserves case)
  usernameLower: varchar('username_lower', { length: 32 }).notNull().unique(), // Lowercase for uniqueness check
  apiKeyHash: varchar('api_key_hash', { length: 64 }).notNull(),
  // Avatar config (moved from separate avatars table)
  bodyColor: varchar('body_color', { length: 7 }).default('#3B82F6').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

// Rooms
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull(),
  description: text('description'),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  ownerId: uuid('owner_id').references(() => users.id),
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
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  username: varchar('username', { length: 32 }), // Snapshot of name at message time
  avatarConfig: jsonb('avatar_config').$type<{ bodyColor: string }>(), // Snapshot of avatar at message time
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Type exports for use elsewhere
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RoomRow = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
