#!/bin/sh
set -e

echo "🔄 Running migrations..."
node packages/server/dist/db/migrate.js

echo "🚀 Starting server..."
node packages/server/dist/index.js
