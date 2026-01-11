#!/bin/sh
set -e

echo "Running outbox-relay database migrations..."
npx node-pg-migrate up --migrations-dir ./migrations || echo "Migrations may have already been applied"

echo "Starting outbox-relay service..."
exec npm start
