# Playeon

Playeon is a real-time synchronized music and video streaming lounge for Telegram groups and communities. It combines a high-performance Telegram MTProto bot with a low-latency Web Mini App featuring both an interactive 3D lounge and a clean 2D playback interface.

---

## Overview

The repository is organized into modular services:

- **`playeon-bot`**: Core Telegram bot powered by `@mtcute`. Manages group playback queues, media fetching via `yt-dlp`, live state synchronization, and hosts the integrated WebSocket/HTTP room server.
- **`playeon-web`**: Next.js (App Router) web application and Telegram Mini App. Offers real-time synchronized listening, synchronized lyrics, responsive playback controls, and an interactive Three.js 3D lounge environment.
- **`deploy/`**: Production Nginx configuration templates, PM2 process manager declarations, and Docker Compose definitions for databases.

---

## Architecture

```
                    ┌────────────────────────┐
                    │    Telegram Clients    │
                    └───────────┬────────────┘
                                │
                 ┌──────────────┴──────────────┐
                 │        Nginx Gateway        │
                 └──────┬──────────────┬───────┘
                        │              │
         HTTP (port 3006)│              │ WS / HTTP (port 3067)
                        ▼              ▼
              ┌────────────────┐ ┌────────────────┐
              │  playeon-web   │ │  playeon-bot   │
              │  (Next.js App) │ │ (mtcute + WS)  │
              └───────┬────────┘ └────────┬───────┘
                      │                   │
                      └─────────┬─────────┘
                                │
                   ┌────────────┴────────────┐
                   ▼                         ▼
            ┌─────────────┐           ┌─────────────┐
            │ MongoDB 8.0 │           │   Redis 7   │
            └─────────────┘           └─────────────┘
```

---

## Prerequisites

- **Node.js**: v20.x or v22.x LTS
- **MongoDB**: v7.0 or v8.0
- **Redis**: v7.x
- **yt-dlp**: Latest release (`pipx install yt-dlp` or binary)
- **ffmpeg**: Installed and available in `$PATH`
- **Telegram API Credentials**: `API_ID`, `API_HASH` from [my.telegram.org](https://my.telegram.org), and a Bot Token from [@BotFather](https://t.me/BotFather).

---

## Quick Start (Development)

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/playeon/playeon.git
cd playeon

# Install all subproject dependencies
npm run install:all
```

### 2. Start Supporting Databases

If Docker is available, spin up local instances of MongoDB and Redis:

```bash
docker compose up -d
```

### 3. Configure Environment Variables

Copy the example configuration files and supply your credentials:

```bash
cp playeon-bot/.env.example playeon-bot/.env
cp playeon-web/.env.example playeon-web/.env
```

Key variables in `playeon-bot/.env`:
- `API_ID` and `API_HASH`: Telegram application credentials
- `BOT_TOKEN`: Bot authentication token
- `MONGO_URI`: `mongodb://localhost:27017`
- `REDIS_URL`: `redis://localhost:6379`
- `ROOM_WS_PORT`: Port for the WebSocket server (default: `3067`)

### 4. Run Development Servers

Run services in separate terminal windows:

```bash
# Terminal 1: Run the bot
npm run dev:bot

# Terminal 2: Run the web application
npm run dev:web
```

---

## Production Deployment

### Option A: Automated Script

```bash
chmod +x deploy.sh
./deploy.sh
```

### Option B: Manual PM2 Process Setup

1. Build the web application:
   ```bash
   cd playeon-web
   npm run build
   cd ..
   ```

2. Start processes via PM2:
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save
   ```

3. Setup systemd autostart:
   ```bash
   pm2 startup
   ```

Sample Nginx reverse proxy templates are available in [`deploy/nginx/playeon.conf`](deploy/nginx/playeon.conf).

---

## Project Status & Disclaimer

This project is actively maintained and continuously evolving. Documentation, setup guides, and repository code annotations have been organized and prepared with the assistance of Gemini.

---

## Author & Attribution

- **Original Author**: Sushi <contact@xysushi.in>
- **Organization**: [Playeon](https://github.com/playeon)

---

## License

This software is released under the **Attribution and Personal Use License (Version 1.0)**. Free for personal, non-commercial evaluation and private use. Redistribution, commercial exploitation, uncredited mirroring, or unauthorized re-branding is strictly prohibited. See the full [LICENSE](LICENSE) file for legal details.
