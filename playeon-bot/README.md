# Playeon (forked) - pure mini-app play system

A fork of the Playeon Telegram bot with the **voice-chat (VC) playback feature and
its entire implementation removed**. All playback now happens through the
synchronized **Web Room** (the Telegram mini-app): a shared player everyone opens
and watches together, kept in sync by the room server.

Every non-VC feature of the original is preserved: the AI chat + tools, the
activity ranking/leaderboard, the content hub, long-term memories, search, group
moderation, account binding, and inline mode.

## What changed vs. the original

### Removed (the VC feature + implementation)
- **`services/voice/`** - the whole voice-chat stack: `ntgcalls` (WebRTC), the
  `PlaybackManager`/`StageManager` state machines, `signaling`, `VoiceService`,
  TTS (`tts`/`piper`), `ffmpegCmd`, `mediaInfo`, the userbot host, and the VC
  play flow.
- **Assistant *placement*** - `AssistantManager`, `AssignmentManager`,
  `ensureAssistant` and their models. These existed only to park userbot accounts
  in group voice chats to stream. (`AssistantAuth`/`errors` are **kept** - the
  content hub and `/bind` reuse that login flow.)
- **Commands** - `/speak`, `/stage`, `/stream`, `/leave`, `/playmode` (routing is
  moot with one surface), and the assistant-management dev commands `/addbot`,
  `/delbot`, `/pausebot`, `/resumebot`.
- Dead Mongo collections (`assistant_bots`, `assistant_assignments`,
  `room_settings`) and the `koffi` native dependency.

### Kept but relocated
- The **shared media layer** (`musicSource`, `ytdlp`, `acquire`, `download`,
  `mediaCache`) moved from `services/voice/` to **`services/media/`** - it was
  always shared with the room, not VC-specific. `parseDuration`/`parseLoopCount`
  were extracted into `services/media/parse.ts`.
- `config.voice.*` was renamed to **`config.media.*`** and trimmed to only the
  acquisition/cache fields. (Env-var names keep their historical `VOICE_*`/`YTDLP_*`
  prefixes so an existing `.env` keeps working - the VC-only ones are just ignored.)

### Rewired
- **Supergroup playback commands** (`/play`, `/vplay`, `/pause`, `/resume`,
  `/skip`, `/seek`, `/fw`, `/bw`, `/loop`, `/queue`, `/playing`, `/end`) now drive
  the group's Web Room instead of the voice chat - the same flow the DM personal
  room already used.
- **AI tools** are room-only: `join_vc` / `leave_vc` / `speak_in_vc` and the
  vc/room routing were dropped; `play_music` / `control_playback` / `now_playing`
  target the room directly.
- The system prompt, `/start` and group-intro cards, and command descriptions
  were reworded from "voice chat" to the Web Room.

## Running

```bash
npm install      # installs deps from package.json (no koffi / VC natives)
npm run typecheck
npm start        # tsx --env-file=.env src/index.ts
```

> The checked-out `node_modules` is a symlink to the original tree for
> convenience; run a fresh `npm install` for a standalone deployment.

Still requires MongoDB, Redis, a Telegram bot token, and the room server env
(`ROOM_*`), plus `yt-dlp`/`ffmpeg` on `PATH` for media download.
