# Playeon

Playeon is a self-hosted, real-time synchronized music and video playback platform engineered for Telegram groups, communities, and decentralized voice lounges. The platform connects a Telegram MTProto client daemon with an interactive Next.js Web Mini App, providing sub-second audio sync, synchronized lyrics, listening leaderboards, and an interactive Three.js 3D lounge.

---

## Key Features

### Telegram Bot (`playeon-bot`)
- **Native MTProto Integration**: Built on `@mtcute` for reliable Telegram protocol communication and high throughput.
- **Queue and Playback Control**: Multi-track queuing with priority handling, loop modes, shuffle, seek, pause, and skip voting.
- **Streaming Pipeline**: Dynamic audio stream extraction using `yt-dlp` and `ffmpeg` with adaptive bitrate transcoding.
- **Embedded Room Server**: Integrated HTTP and WebSocket server handling real-time peer synchronization without requiring an external signaling broker.
- **Community Analytics**: Persistent tracking of member listening time, top tracks, and group leaderboards backed by MongoDB and Redis.

### Web Mini App (`playeon-web`)
- **Dual Interface Modes**:
  - **3D Lounge**: An interactive visual environment powered by Three.js and React Three Fiber featuring dynamic audio-reactive elements and user avatars.
  - **2D Stream Player**: A lightweight, mobile-first interface optimized for Telegram Web Mini App embedded viewports.
- **Sub-Second Synchronization**: Clock-drift compensated audio playback synchronizing all connected listeners to within 50 milliseconds of the host timeline.
- **Synchronized Lyrics**: Real-time line-by-line lyric highlighting synced to track playback timestamps.
- **Interactive Reactions**: Ephemeral live floating reactions, chat messages, and gesture animations broadcast over WebSockets.

---

## System Architecture

```
                    +------------------------------------+
                    |        Telegram Client Apps        |
                    +-----------------+------------------+
                                      |
                                      | HTTPS / WSS
                                      v
                    +------------------------------------+
                    |        Nginx Reverse Proxy         |
                    +--------+------------------+--------+
                             |                  |
           HTTP / Static     |                  | WebSocket / API
           Port 3006         |                  | Port 3067
                             v                  v
                    +----------------+  +----------------+
                    |  playeon-web   |  |  playeon-bot   |
                    | Next.js App    |  | mtcute + WS    |
                    +--------+-------+  +-------+--------+
                             |                  |
                             +--------+---------+
                                      |
                     +----------------+----------------+
                     |                                 |
                     v                                 v
          +--------------------+             +-------------------+
          |    MongoDB 8.0     |             |      Redis 7      |
          |  Persistent State  |             |  Pub/Sub & Cache  |
          +--------------------+             +-------------------+
```

---

## Directory Structure

```
playeon/
├── playeon-bot/               # Telegram bot and WebSocket room server
│   ├── src/
│   │   ├── commands/          # Telegram bot command handlers
│   │   ├── core/              # Audio playback pipeline and yt-dlp handlers
│   │   ├── database/          # Mongoose models and Redis clients
│   │   ├── server/            # WebSocket room protocol and HTTP endpoints
│   │   └── index.ts           # Service initialization entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── playeon-web/               # Next.js Web Mini App
│   ├── src/
│   │   ├── app/               # App Router pages and layouts
│   │   ├── components/        # React UI and Three.js canvas components
│   │   ├── hooks/             # WebSocket sync, audio player, and theme hooks
│   │   ├── lib/               # Utility functions and Telegram WebApp bridge
│   │   └── types/             # Shared TypeScript definitions
│   ├── package.json
│   ├── next.config.mjs
│   └── .env.example
├── deploy/                    # Infrastructure declarations
│   ├── nginx/                 # Production Nginx site configurations
│   └── docker-compose.yml     # Container definitions for MongoDB and Redis
├── ecosystem.config.cjs       # PM2 process manager configuration
├── deploy.sh                  # Automated deployment script
├── LICENSE                    # Attribution and Personal Use License (v1.0)
└── package.json               # Root workspace scripts
```

---

## Prerequisites

Ensure the following runtimes and utilities are installed on the host system:

- **Node.js**: Version 20.x LTS or 22.x LTS
- **MongoDB**: Version 7.0 or higher (8.0 recommended)
- **Redis**: Version 7.0 or higher
- **yt-dlp**: Up-to-date release installed in system `$PATH`
- **ffmpeg**: Installed with `libmp3lame` and `libopus` support
- **Telegram API Credentials**:
  - `API_ID` and `API_HASH` obtained from [my.telegram.org](https://my.telegram.org)
  - `BOT_TOKEN` obtained from [@BotFather](https://t.me/BotFather)

---

## Configuration Reference

### Bot Service (`playeon-bot/.env`)

| Variable | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `API_ID` | Integer | Telegram API identification number | Required |
| `API_HASH` | String | Telegram API hash string | Required |
| `BOT_TOKEN` | String | Bot authentication token from BotFather | Required |
| `BOT_USERNAME` | String | Telegram bot handle (without @) | Required |
| `MONGO_URI` | String | MongoDB connection URI | `mongodb://localhost:27017/playeon` |
| `REDIS_URL` | String | Redis server connection URI | `redis://localhost:6379` |
| `ROOM_WS_PORT` | Integer | TCP port for embedded WebSocket server | `3067` |
| `WEB_APP_URL` | String | Public HTTPS URL where `playeon-web` is hosted | `https://playeon.domain.com` |
| `DOWNLOAD_DIR` | String | Directory path for cached media files | `/tmp/playeon-cache` |
| `MAX_QUEUE_SIZE` | Integer | Maximum tracks allowed per room queue | `50` |

### Web Service (`playeon-web/.env`)

| Variable | Type | Description | Default |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_WS_URL` | String | Public WebSocket URL pointing to `playeon-bot` | `wss://playeon.domain.com/ws` |
| `NEXT_PUBLIC_API_URL` | String | Public HTTP API URL of the bot daemon | `https://playeon.domain.com/api` |
| `NEXT_PUBLIC_BOT_USERNAME`| String | Telegram username of the companion bot | Required |

---

## Installation and Local Setup

### 1. Repository Setup

```bash
git clone https://github.com/playeon/playeon.git
cd playeon

# Install all workspace dependencies
npm run install:all
```

### 2. Launch Databases

Start local MongoDB and Redis instances using Docker Compose:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

### 3. Environment Setup

Generate local environment files from templates:

```bash
cp playeon-bot/.env.example playeon-bot/.env
cp playeon-web/.env.example playeon-web/.env
```

Populate the required credentials in both files.

### 4. Run Development Instances

Start the services concurrently or in separate shells:

```bash
# Terminal 1: Run Telegram Bot & Room Server
npm run dev:bot

# Terminal 2: Run Next.js Mini App
npm run dev:web
```

---

## Bot Command Reference

The following commands are registered in group chats where the bot is added:

| Command | Arguments | Scope | Description |
| :--- | :--- | :--- | :--- |
| `/play` | `<query \| url>` | Group / Lounge | Searches or extracts audio and appends it to the active playback queue. |
| `/queue` | None | Group / Lounge | Displays current playback queue, remaining track durations, and upcoming items. |
| `/skip` | None | Group / Lounge | Initiates a vote to skip or immediately skips current track (if administrator). |
| `/pause` | None | Administrators | Pauses active room playback and freezes audio sync timeline. |
| `/resume` | None | Administrators | Resumes audio playback from the frozen timestamp. |
| `/stop` | None | Administrators | Halts playback, clears the active queue, and resets room session state. |
| `/lyrics` | None | Group / Lounge | Fetches and presents synchronized lyrics for the active track. |
| `/leaderboard` | None | Group | Displays group listening metrics, top active listeners, and total hours streamed. |
| `/lounge` | None | Group / Lounge | Sends the direct button to launch the Web Mini App for the current chat room. |

---

## Real-Time Synchronization Protocol

The bot and connected web clients communicate over a lightweight binary/JSON WebSocket protocol on port `3067`.

### Core Client Messages

```json
{
  "type": "join",
  "roomId": "-1001234567890",
  "userId": 987654321,
  "initData": "user_telegram_init_data_string"
}
```

```json
{
  "type": "seek",
  "positionSeconds": 142.5
}
```

```json
{
  "type": "reaction",
  "reactionId": "fire"
}
```

### Server Broadcast Events

```json
{
  "event": "room_state",
  "data": {
    "roomId": "-1001234567890",
    "track": {
      "id": "dQw4w9WgXcQ",
      "title": "Track Title",
      "artist": "Artist Name",
      "duration": 213,
      "audioUrl": "/stream/dQw4w9WgXcQ.mp3"
    },
    "playback": {
      "status": "playing",
      "position": 45.2,
      "serverTime": 1789855389000
    },
    "listenersCount": 14
  }
}
```

Clients calculate client-server clock offset on connection using an NTP-style ping exchange, ensuring synchronization precision even over mobile cellular connections.

---

## Production Deployment

### Automated Script

Execute the self-contained deployment script from the project root:

```bash
chmod +x deploy.sh
./deploy.sh
```

### Manual Setup via PM2

1. Build the production bundle for the web application:
   ```bash
   cd playeon-web
   npm run build
   cd ..
   ```

2. Compile TypeScript for the bot daemon:
   ```bash
   cd playeon-bot
   npm run build
   cd ..
   ```

3. Launch and persist services with PM2:
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup
   ```

4. Verify status:
   ```bash
   pm2 status
   pm2 logs
   ```

### Reverse Proxy Configuration

A sample Nginx configuration file is provided in `deploy/nginx/playeon.conf`. It configures SSL termination, WebSocket upgrade forwarding for `/ws`, and proxy caching for media assets.

---

## Disclaimer & Documentation

This codebase is continuously maintained. Architecture documentation, command references, and deployment scripts have been prepared and organized with the assistance of Gemini.

---

## Author & Attribution

- **Lead Architect**: Sushi <contact@xysushi.in>
- **Organization**: [Playeon](https://github.com/playeon)

---

## License

This project is licensed under the **Attribution and Personal Use License (Version 1.0)**. Free for personal, non-commercial evaluation, learning, and private hosting. Redistribution, uncredited forks, commercial exploitation, or unauthorized rebranding is prohibited. Review the full [LICENSE](LICENSE) file for complete terms.
