#!/usr/bin/env bash
set -euo pipefail

echo "==> Pulling latest code..."
git pull origin main

echo "==> Building Docker image..."
docker compose build --no-cache

echo "==> Restarting container..."
docker compose up -d

echo "==> Done. Check logs: docker compose logs -f fk-tool"
