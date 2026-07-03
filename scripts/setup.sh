#!/usr/bin/env bash
set -e

echo "================================================"
echo "  Covernor Platform — Setup"
echo "================================================"
echo ""

# 1. Environment file
if [ ! -f .env ]; then
  echo "[1/5] Creating .env from .env.example..."
  cp .env.example .env
  echo "      Done. Edit .env later to add LLM keys (optional)."
else
  echo "[1/5] .env already exists, skipping."
fi

# 2. Install dependencies
echo "[2/5] Installing backend dependencies..."
npm install --silent

echo "      Installing frontend dependencies..."
cd approval-console
npm install --silent
cd ..

# 3. Start PostgreSQL + Redis (Docker)
echo "[3/5] Starting PostgreSQL and Redis..."
if command -v docker &> /dev/null; then
  docker compose up -d --wait
  echo "      Docker services are up."
else
  echo ""
  echo "  ⚠  Docker not found. PostgreSQL and Redis must be running manually."
  echo "     DATABASE_URL default: postgresql://covernor:covernor@localhost:15432/covernor"
  echo ""
fi

# 4. Generate Prisma client + apply schema
echo "[4/5] Setting up database..."
npx prisma generate
if [ -d prisma/migrations ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  npx prisma migrate deploy
else
  npx prisma db push
fi

# 5. Check Redis
echo "[5/5] Checking Redis..."
if command -v redis-cli &> /dev/null && redis-cli ping &> /dev/null; then
  echo "      Redis is running."
elif command -v docker &> /dev/null && docker compose exec -T redis redis-cli ping &> /dev/null; then
  echo "      Redis is running (docker compose)."
else
  echo ""
  echo "  ⚠  Redis is NOT reachable. BullMQ needs it."
  echo "     Start with: docker compose up -d"
  echo "     Or: brew services start redis"
  echo ""
fi

echo ""
echo "================================================"
echo "  Setup complete! Start the platform with:"
echo ""
echo "    npm run dev"
echo "================================================"
