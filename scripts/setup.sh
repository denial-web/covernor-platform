#!/usr/bin/env bash
set -e

echo "================================================"
echo "  Minister-Governor Platform — Setup"
echo "================================================"
echo ""

# 1. Environment file
if [ ! -f .env ]; then
  echo "[1/4] Creating .env from .env.example..."
  cp .env.example .env
  echo "      Done. Edit .env later to add LLM keys (optional)."
else
  echo "[1/4] .env already exists, skipping."
fi

# 2. Install dependencies
echo "[2/4] Installing backend dependencies..."
npm install --silent

echo "      Installing frontend dependencies..."
cd approval-console
npm install --silent
cd ..

# 3. Generate Prisma client + push schema
echo "[3/4] Setting up database..."
npx prisma generate
npx prisma db push --accept-data-loss 2>/dev/null || npx prisma db push

# 4. Check Redis
echo "[4/4] Checking Redis..."
if command -v redis-cli &> /dev/null && redis-cli ping &> /dev/null; then
  echo "      Redis is running."
else
  echo ""
  echo "  ⚠  Redis is NOT running. BullMQ needs it."
  echo "     Start it with one of:"
  echo "       brew services start redis          # macOS (Homebrew)"
  echo "       sudo systemctl start redis         # Linux"
  echo "       docker run -d -p 6379:6379 redis   # Docker"
  echo ""
fi

echo ""
echo "================================================"
echo "  Setup complete! Start the platform with:"
echo ""
echo "    npm run dev"
echo "================================================"
