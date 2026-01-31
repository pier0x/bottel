# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/

# Install dependencies
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY packages/client ./packages/client
COPY assets ./assets

# Copy assets to client public folder
RUN cp -r assets/* packages/client/public/

# Build shared
RUN npm run build -w @bottel/shared

# Build server
RUN npm run build -w @bottel/server

# Build client
RUN npm run build -w @bottel/client

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/client/dist ./packages/client/dist

# Copy drizzle migrations if they exist
COPY --from=builder /app/packages/server/drizzle ./packages/server/drizzle

# Copy start script
COPY scripts/start.sh ./start.sh
RUN chmod +x ./start.sh

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["./start.sh"]
