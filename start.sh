#!/bin/sh
set -e
echo "Running Prisma migrations..."
npx prisma migrate deploy
echo "Running seed..."
npx prisma db seed || true
echo "Starting Next.js..."
exec node server.js
