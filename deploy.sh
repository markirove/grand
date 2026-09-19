#!/usr/bin/env bash
set -euo pipefail

echo "==> Deploying Playeon Workspace..."

# Verify dependencies
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required."; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "Error: pm2 is required. Install with: npm i -g pm2"; exit 1; }

# Create logs directory
mkdir -p logs

# Check environment files
if [ ! -f "playeon-bot/.env" ]; then
    echo "Warning: playeon-bot/.env not found! Copying from playeon-bot/.env.example"
    cp playeon-bot/.env.example playeon-bot/.env
fi

if [ ! -f "playeon-web/.env" ]; then
    echo "Warning: playeon-web/.env not found! Copying from playeon-web/.env.example"
    cp playeon-web/.env.example playeon-web/.env
fi

# Install dependencies
echo "==> Installing dependencies..."
cd playeon-bot && npm install
cd ../playeon-web && npm install
cd ..

# Build Web Application
echo "==> Building Next.js Web Application..."
cd playeon-web && npm run build
cd ..

# Start with PM2
echo "==> Starting processes with PM2..."
pm2 start ecosystem.config.cjs
pm2 save

echo "==> Deployment complete!"
pm2 status
