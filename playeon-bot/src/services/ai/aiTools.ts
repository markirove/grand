import { roomManager } from '../room/RoomManager.js'
import { runRoomPlayback } from '../room/roomFlow.js'
import { roomJoinUrl, roomYou } from '../room/roomLink.js'
import { cancelKeyboard, controlLine } from '../playback/playcard.js'
import { roomLiveCardId, paintRoomCard, serialCardEdit, stopRoomCard } from '../room/roomCards.js'
import { searchTracks } from '../media/musicSource.js'
import {
  readRoomSettings,
  writeRoomMode,
  writeRoomStyle,
  isRoomStyleId,
  styleById,
} from '../room/roomSettings.js'
import type { RoomMode } from '../../models/roomAccess.js'
import { md } from '@mtcute/markdown-parser'
import type { MessageContext } from '@mtcute/dispatcher'
import type { ToolDefinition } from './mistralClient.js'
import { tg, botInfo } from '../../client.js'
import { addUserMemory, deleteUserMemory, getUserMemoryData } from './aiMemory.js'
import { collections } from '../mongo.js'

export function formatDurationSec(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return 'live'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Strip YouTube auto-channel cruft ("KATSEYE - Topic", "ArtistVEVO", "- Official") from an artist name. */
export function cleanArtist(name: string | null | undefined): string | null {
  if (!name) return null
  const cleaned = name
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .replace(/\s*-\s*Official(\s*(Channel|Artist|Music|Audio))?$/i, '')
    .replace(/\s*official\s+YouTube\s+channel$/i, '')
    .trim()
  return cleaned || null
}

export interface ToolContext {
  msg: MessageContext
  chatId: number
  groupId: string
  user: {
    id: number
    name: string
  }
}

export const AI_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'play_track',
      description: 'Play or queue a specific song or video in the room. Use whenever the user wants to play, put on, start, stream, drop, or queue a named track, artist, or link.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Song name, artist, YouTube URL, or search query.',
          },
          video: {
            type: 'boolean',
            description: 'Explicit choice: true for video stream with sound, false for audio only. If user did not specify, omit this (2D rooms default to video, 3D rooms default to audio).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_tracks',
      description: 'Search, find, look up, or browse songs, music videos, or artists on YouTube and return a numbered list of choices without queueing anything.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Song title, artist name, or search keywords.',
          },
          limit: {
            type: 'number',
            description: 'Number of results to return (default 5, maximum 10).',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause_playback',
      description: 'Pause the currently playing music or video in the room. MUST be called whenever user asks to pause, stop music, freeze playback, or hold.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_playback',
      description: 'Resume paused music or video in the room. MUST be called whenever user asks to resume, unpause, continue, or start playing again.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skip_track',
      description: 'Skip the current playing track and advance to the next song in the queue. MUST be called whenever the user asks to skip, next, play next, next song, or change track.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'seek_position',
      description: 'Seek playback to a specific timestamp, seconds, or forward/backward offset (e.g. "1:30", 90, "+30s", "-15s"). MUST be called when the user asks to seek, jump, scrub, skip ahead within the track, fast forward, or rewind.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Position to jump to (e.g. "1:30", "90", "+30s", "-15s").',
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_room_status',
      description: 'Get live info about the current track, progress, upcoming tracks, and participants. Use when the user asks what is playing, what song is this, what is on now, or for the room status.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_queue',
      description: 'List the currently playing track plus all queued upcoming tracks, with links, durations, and requesters. Use when the user asks to see the queue, the playlist, what is next, or what is coming up.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_queue',
      description: 'Clear, remove, wipe, or delete all upcoming songs from the queue. MUST be called whenever the user asks to clear queue, empty queue, or wipe upcoming tracks.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_loop',
      description: 'Set loop / repeat for the current track (count: 0 = off, 1 = repeat once, 999 = keep looping). Use when the user asks to loop, repeat, or replay the current track.',
      parameters: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: 'Loop repeat count (0 for off, 1 for repeat once, 999 for continuous).',
          },
        },
        required: ['count'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_room_link',
      description: 'Get the room link for others to join and watch/listen in sync. Use when the user asks for the room link, invite link, share link, or join link.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_playback',
      description: 'Stop all playback and end the active room session.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_room_mode',
      description: "Switch the room's visual display mode between 2D and 3D.",
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['2d', '3d'],
            description: 'The visual mode: "2d" for clean 2D layout, or "3d" for immersive 3D space.',
          },
        },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_autoplay',
      description: 'Turn autoplay / radio mode ON or OFF for the room. When enabled, Playeon automatically queues and plays similar music recommendations when the queue ends.',
      parameters: {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'true to enable autoplay, false to disable autoplay.',
          },
        },
        required: ['enabled'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_room_style',
      description: 'Change the room visual style / theme (Midnight/default, Poolrooms, Halloween, Sushi).',
      parameters: {
        type: 'object',
        properties: {
          style: {
            type: 'string',
            enum: ['default', 'midnight', 'poolrooms', 'halloween', 'sushi'],
            description: 'The theme id: "default" (or "midnight"), "poolrooms", "halloween", or "sushi".',
          },
        },
        required: ['style'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'Save or remember a concise, noteworthy fact, musical taste, favorite artist/genre, habit, or preference about this user for long-term memory.',
      parameters: {
        type: 'object',
        properties: {
          fact: {
            type: 'string',
            description: 'Concise summary of the memory or preference (e.g. "Loves anime openings and Shadows House", "Dislikes country music", "Prefers 3D room mode").',
          },
        },
        required: ['fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memory',
      description: 'Delete or forget an outdated, obsolete, or unwanted memory about this user.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'The memory text, topic, keyword, or index number to remove/forget.',
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view_memories',
      description: 'View all stored long-term memory facts and preferences for this user.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
]

export function resolveActiveRoom(userId: number, currentGroupId: string): string {
  // If currentGroupId is already playing/active, keep it
  const snap = roomManager.getSnapshot(currentGroupId)
  if (snap?.current) return currentGroupId

  // Search all rooms for one where this user is connected/online
  const strId = String(userId)
  for (const [gid, room] of (roomManager as any).rooms.entries()) {
    if (!room.current) continue
    for (const conn of room.connections.values()) {
      if (conn.participant?.id === strId) return gid
    }
  }

  // Search all rooms for one where this user requested the current track
  for (const [gid, room] of (roomManager as any).rooms.entries()) {
    if (room.current && room.current.requestedById === strId) return gid
  }

  return currentGroupId
}

export function parseRelaxedArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {}
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    try {
      const cleaned = trimmed.replace(/,\s*([}\]])/g, '$1')
      return JSON.parse(cleaned)
    } catch {
      const out: Record<string, unknown> = {}
      const kvRegex = /"([^"]+)"\s*:\s*(?:"([^"]*)"|(\d+(?:\.\d+)?)|(true|false)|null)/g
      let match: RegExpExecArray | null
      while ((match = kvRegex.exec(trimmed)) !== null) {
        const key = match[1]!
        if (match[2] !== undefined) out[key] = match[2]
        else if (match[3] !== undefined) out[key] = Number(match[3])
        else if (match[4] !== undefined) out[key] = match[4] === 'true'
      }
      return out
    }
  }
}

export async function executeAiTool(
  toolName: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<string> {
  // Each tool has exactly one canonical name; the model is expected to call it
  // verbatim. Only case/whitespace is normalised here.
  const normalizedToolName = toolName.trim().toLowerCase()
  const args = parseRelaxedArgs(rawArgs)

  const { groupId: rawGroupId, chatId, user, msg } = ctx
  const groupId = resolveActiveRoom(user.id, rawGroupId)
  const targetChatId = Number(groupId) || chatId

  switch (normalizedToolName) {
    case 'play_track': {
      const query = String(args.query || '').trim()
      if (!query) {
        return JSON.stringify({ success: false, error: 'empty_query', message: 'No song query was provided.' })
      }

      // Audio vs Video determination:
      // If user explicitly specified, honor it.
      // Otherwise: 2D room defaults to video, 3D room defaults to audio.
      let wantVideo: boolean
      if (typeof args.video === 'boolean') {
        wantVideo = args.video
      } else {
        const roomSettings = await readRoomSettings(groupId)
        wantVideo = roomSettings.mode === '2d'
      }

      try {
        const status = await msg.replyText(md`Preparing for the room…`, {
          replyMarkup: cancelKeyboard(),
        })

        const result = await runRoomPlayback({
          tg,
          db: collections,
          chatId,
          wantVideo,
          quality: null,
          requestedBy: user.name,
          requestedById: String(user.id),
          statusMessageId: status.id,
          commandMsgId: msg.id,
          source: { kind: 'query', query },
        })

        if (!result) {
          return JSON.stringify({
            success: false,
            error: 'playback_failed',
            message: `Could not play "${query}". Please check the track name or try another song.`,
          })
        }

        const isNowPlaying = result.position === 0
        const resolvedTitle = result.title || query
        const resolvedArtist = cleanArtist(result.artist)

        if (isNowPlaying) {
          return JSON.stringify({
            success: true,
            action: 'now_playing',
            title: resolvedTitle,
            artist: resolvedArtist,
            video: wantVideo,
            message: `Done. "${resolvedTitle}"${resolvedArtist ? ` by ${resolvedArtist}` : ''} is playing now. In your reply, tell the user it's playing now (not queued). This track is handled, do not call play_track or any other tool again for it.`,
          })
        } else {
          return JSON.stringify({
            success: true,
            action: 'enqueued',
            position: result.position,
            title: resolvedTitle,
            artist: resolvedArtist,
            video: wantVideo,
            message: `Done. "${resolvedTitle}"${resolvedArtist ? ` by ${resolvedArtist}` : ''} is in the queue at position #${result.position} and is NOT playing yet. In your reply, say you added it to the queue (not "now playing"). This track is handled, do not call play_track or any other tool again for it.`,
          })
        }
      } catch (err: unknown) {
        const msgStr = err instanceof Error ? err.message : String(err)
        return JSON.stringify({
          success: false,
          error: 'play_failed',
          message: msgStr,
        })
      }
    }

    case 'search_tracks': {
      const query = String(args.query || '').trim()
      if (!query) {
        return JSON.stringify({ success: false, error: 'empty_query', message: 'No search query was provided.' })
      }
      const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 10)
      try {
        const results = await searchTracks(query, limit)
        if (results.length === 0) {
          return JSON.stringify({
            success: false,
            query,
            error: 'no_results',
            message: `No search results found for "${query}".`,
          })
        }
        const nativeList = results
          .map(
            (t, i) =>
              `${i + 1}. [${t.title}](${t.url}) · ${cleanArtist(t.uploader) || t.credits || 'Unknown Artist'} (\`${formatDurationSec(t.duration)}\`)`,
          )
          .join('\n')

        const richMessage = `Search results for "${query}":\n\n${nativeList}\n\nReply with a track number (e.g. "play 1") to stream it in your room.`

        return JSON.stringify({
          success: true,
          query,
          count: results.length,
          rich_message: richMessage,
          results: results.map((t, i) => ({
            index: i + 1,
            title: t.title,
            artist: cleanArtist(t.uploader) || t.credits || 'Unknown Artist',
            duration: formatDurationSec(t.duration),
            url: t.url,
          })),
          message:
            'These are search candidates only. NOTHING has been played or added to the queue by this search. Reply with the rich_message text exactly as given, then stop. Do NOT say any track is now playing, queued, "coming next", or "lined up". If the user asked to play a specific track, call play_track instead of showing this list.',
        })
      } catch (err: unknown) {
        return JSON.stringify({
          success: false,
          query,
          error: 'search_failed',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    case 'pause_playback': {
      const res = roomManager.pause(groupId, user.name, String(user.id))
      if (res === 'nothing') {
        return JSON.stringify({ success: false, error: 'nothing_playing', message: 'Nothing is currently playing in the room to pause.' })
      }
      void paintRoomCard(targetChatId)
      if (res === 'already') {
        return JSON.stringify({ success: true, action: 'already_paused', message: 'Playback is already paused.' })
      }
      return JSON.stringify({ success: true, action: 'paused', message: 'Playback has been paused.' })
    }

    case 'resume_playback': {
      const res = roomManager.play(groupId, user.name, String(user.id))
      if (res === 'nothing') {
        return JSON.stringify({ success: false, error: 'nothing_playing', message: 'Nothing is currently loaded in the room to resume.' })
      }
      void paintRoomCard(targetChatId)
      if (res === 'already') {
        return JSON.stringify({ success: true, action: 'already_playing', message: 'Playback is already playing.' })
      }
      return JSON.stringify({ success: true, action: 'resumed', message: 'Playback has resumed.' })
    }

    case 'skip_track': {
      const snapBefore = roomManager.getSnapshot(groupId)
      if (!snapBefore || !snapBefore.current) {
        return JSON.stringify({
          success: false,
          error: 'nothing_playing',
          message: 'Nothing is currently playing in your room to skip. Let the user know politely and ask what they want to play.',
        })
      }

      const currentTitle = snapBefore.current.title
      const hadNext = snapBefore.queue.length > 0
      const nextTitle = hadNext ? snapBefore.queue[0]?.title : null

      const oldCard = roomLiveCardId(targetChatId)
      const res = roomManager.skip(groupId, user.name, String(user.id))
      if (res === 'nothing') {
        return JSON.stringify({
          success: false,
          error: 'nothing_playing',
          message: 'Nothing is currently playing in your room to skip.',
        })
      }

      if (res === 'skipped_last' || !nextTitle) {
        stopRoomCard(targetChatId)
        if (oldCard) {
          const line = controlLine({
            video: snapBefore.current.video ?? false,
            action: 'skipped',
            name: user.name,
            id: user.id,
            youId: roomYou(groupId),
          })
          void serialCardEdit(oldCard, () =>
            tg.editMessage({
              chatId: targetChatId,
              message: oldCard,
              text: line,
              invertMedia: false,
              disableWebPreview: true,
            }).catch(() => { }),
          )
        }
        return JSON.stringify({
          success: true,
          action: 'skipped_last',
          skippedTrack: currentTitle,
          hasMore: false,
          message: `Skipped "${currentTitle}". That was the final track in the queue, so playback has stopped and the room is now idle.`,
        })
      }

      // When there is a next track, promoteNext already updated liveByChat to the new track's card.
      // Only edit oldCard if it is distinct from the new live card.
      const currentLiveCard = roomLiveCardId(targetChatId)
      if (oldCard && oldCard !== currentLiveCard) {
        const line = controlLine({
          video: snapBefore.current.video ?? false,
          action: 'skipped',
          name: user.name,
          id: user.id,
          youId: roomYou(groupId),
        })
        void serialCardEdit(oldCard, () =>
          tg.editMessage({
            chatId: targetChatId,
            message: oldCard,
            text: line,
            invertMedia: false,
            disableWebPreview: true,
          }).catch(() => { }),
        )
      }

      return JSON.stringify({
        success: true,
        action: 'skipped',
        skippedTrack: currentTitle,
        nowPlaying: nextTitle,
        hasMore: true,
        message: `Skipped "${currentTitle}". Now playing "${nextTitle}".`,
      })
    }

    case 'seek_position': {
      const snap = roomManager.getSnapshot(groupId)
      if (!snap || !snap.current) {
        return JSON.stringify({
          success: false,
          error: 'nothing_playing',
          message: 'Nothing is currently playing in the room to seek.',
        })
      }
      const duration = snap.current.duration
      if (duration == null || duration <= 0) {
        return JSON.stringify({
          success: false,
          error: 'is_live',
          message: 'This is a live stream with no fixed duration, so seeking is disabled.',
        })
      }

      const elapsed = snap.playing
        ? Math.max(0, Math.floor((snap.serverTime - snap.startedAt) / 1000))
        : Math.floor(snap.pausedPositionSec)

      let target: number = NaN
      const rawTarget = args.target ?? args.seconds

      if (typeof rawTarget === 'number') {
        target = rawTarget
      } else if (typeof rawTarget === 'string') {
        const str = rawTarget.trim()
        const isRelative = str.startsWith('+') || str.startsWith('-')
        if (str.includes(':')) {
          const parts = str.replace(/^[+-]/, '').split(':').map(Number)
          if (parts.length === 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
            const abs = parts[0]! * 60 + parts[1]!
            target = isRelative ? elapsed + (str.startsWith('-') ? -abs : abs) : abs
          } else if (parts.length === 3 && !isNaN(parts[0]!) && !isNaN(parts[1]!) && !isNaN(parts[2]!)) {
            const abs = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
            target = isRelative ? elapsed + (str.startsWith('-') ? -abs : abs) : abs
          }
        } else {
          const num = parseFloat(str.replace(/s$/i, '').replace(/m$/i, ''))
          if (!isNaN(num)) {
            const inSec = str.toLowerCase().endsWith('m') ? Math.round(num * 60) : Math.round(num)
            target = isRelative ? elapsed + inSec : inSec
          }
        }
      }

      if (isNaN(target) || target < 0) {
        return JSON.stringify({
          success: false,
          error: 'invalid_target',
          message: 'Please provide a valid position (e.g. "1:30", 90, "+30s", or "-15s").',
        })
      }

      // Clamp target to track bounds
      target = Math.max(0, Math.min(target, Math.max(0, Math.floor(duration) - 1)))

      const res = roomManager.seek(groupId, target, user.name, String(user.id))
      if (res === 'nothing') {
        return JSON.stringify({ success: false, error: 'nothing_playing', message: 'Nothing is currently playing.' })
      }
      if (res === 'live') {
        return JSON.stringify({ success: false, error: 'is_live', message: 'Cannot seek in a live stream.' })
      }

      void paintRoomCard(targetChatId)
      return JSON.stringify({
        success: true,
        action: 'seeked',
        positionSeconds: target,
        positionFormatted: formatDurationSec(target),
        message: `Playback jumped to ${formatDurationSec(target)}.`,
      })
    }

    case 'get_room_status': {
      const snap = roomManager.getSnapshot(groupId)
      const settings = await readRoomSettings(groupId)
      const botName = botInfo.username ?? 'Playeon'
      const autoplay = roomManager.getAutoplay(groupId)
      const roomInternal = (roomManager as any).rooms?.get(groupId)
      const recentHistory = roomInternal?.recentTrackHistory?.map((h: any) => ({
        title: h.title,
        artist: h.uploader,
      })) ?? []

      const participants = snap?.participants?.map((p) => ({
        id: p.id,
        name: p.name,
        username: p.username,
        role: p.role,
        online: p.online,
        present: p.present,
      })) ?? []

      if (!snap || !snap.current) {
        return JSON.stringify({
          active: false,
          status: 'idle',
          autoplay,
          mode: settings.mode,
          style: settings.style,
          message: 'Room is currently idle with no active track.',
          roomUrl: roomJoinUrl(groupId),
          participantCount: participants.filter((p) => p.online).length,
          participants,
          recentHistory,
        })
      }

      const elapsedSec = snap.playing
        ? Math.max(0, Math.floor((snap.serverTime - snap.startedAt) / 1000))
        : Math.floor(snap.pausedPositionSec)

      const isBotNowPlaying = !snap.current.requestedById && (snap.current.requestedBy === botName || snap.current.requestedBy === 'Playeon' || !snap.current.requestedBy)
      const isYouNowPlaying = snap.current.requestedById === String(user.id) || snap.current.requestedBy === user.name
      const requestedByFormatted = isBotNowPlaying ? 'Playeon (Autoplay)' : (isYouNowPlaying ? 'you' : snap.current.requestedBy)

      return JSON.stringify({
        active: true,
        status: snap.playing ? 'playing' : 'paused',
        title: snap.current.title,
        artist: cleanArtist(snap.current.artist),
        progress: `${formatDurationSec(elapsedSec)} / ${snap.current.duration ? formatDurationSec(snap.current.duration) : 'live'}`,
        duration: snap.current.duration ? formatDurationSec(snap.current.duration) : 'live',
        sourceUrl: snap.current.sourceUrl || roomJoinUrl(groupId),
        requestedBy: requestedByFormatted,
        isYou: isYouNowPlaying,
        isAutoplay: isBotNowPlaying,
        requestedById: snap.current.requestedById,
        video: snap.current.video,
        autoplay,
        mode: settings.mode,
        style: settings.style,
        loopRemaining: roomInternal?.loopRemaining ?? 0,
        queueCount: snap.queue.length,
        participantCount: participants.filter((p) => p.online).length,
        participants,
        recentHistory,
        roomUrl: roomJoinUrl(groupId),
      })
    }

    case 'get_queue': {
      const snap = roomManager.getSnapshot(groupId)
      const botName = botInfo.username ?? 'Playeon'
      const current = snap?.current
      const queue = snap?.queue ?? []

      if (!current && queue.length === 0) {
        return JSON.stringify({
          active: false,
          count: 0,
          tracks: [],
          message: 'The queue is currently empty and nothing is playing.',
        })
      }

      const isYouNow = current ? (current.requestedById === String(user.id) || current.requestedBy === user.name) : false
      const isBotNow = current ? (!current.requestedById && (current.requestedBy === botName || current.requestedBy === 'Playeon' || !current.requestedBy)) : false

      return JSON.stringify({
        active: !!current,
        nowPlaying: current ? {
          title: current.title,
          artist: cleanArtist(current.artist),
          duration: current.duration ? formatDurationSec(current.duration) : 'live',
          sourceUrl: current.sourceUrl || roomJoinUrl(groupId),
          requestedBy: isBotNow ? 'Playeon (Autoplay)' : (isYouNow ? 'you' : current.requestedBy),
          isYou: isYouNow,
          isAutoplay: isBotNow,
        } : null,
        queueCount: queue.length,
        tracks: queue.map((t, idx) => {
          const isBot = !t.requestedById && (t.requestedBy === botName || t.requestedBy === 'Playeon' || !t.requestedBy)
          const isYou = t.requestedById === String(user.id) || t.requestedBy === user.name
          return {
            position: idx + 1,
            title: t.title,
            artist: cleanArtist(t.artist),
            duration: t.duration ? formatDurationSec(t.duration) : 'live',
            sourceUrl: t.sourceUrl || roomJoinUrl(groupId),
            requestedBy: isBot ? 'Playeon (Autoplay)' : (isYou ? 'you' : t.requestedBy),
            isYou,
            isAutoplay: isBot,
          }
        }),
        format_instructions: 'When presenting the queue, format each item as a clickable link with duration and requester: 1. [Title](sourceUrl) (duration) · queued by requester. Use a middle dot, never a long dash. If requester is "you", say "queued by you". If queued by autoplay, say "queued by Playeon Autoplay".',
      })
    }

    case 'clear_queue': {
      const snap = roomManager.getSnapshot(groupId)
      const count = snap?.queue.length ?? 0
      const cleared = await roomManager.clearQueue(groupId, user.name, String(user.id))
      void paintRoomCard(targetChatId)
      return JSON.stringify({
        success: cleared,
        clearedCount: count,
        message: cleared
          ? `Cleared ${count} upcoming track${count === 1 ? '' : 's'} from the queue.`
          : 'The queue was already empty.',
      })
    }

    case 'set_loop': {
      let count = Number(args.count)
      if (isNaN(count)) count = 999
      const res = roomManager.setLoop(groupId, count)
      if (res === 'nothing') {
        return JSON.stringify({ success: false, error: 'nothing_playing', message: 'Nothing is currently playing to loop.' })
      }
      void paintRoomCard(targetChatId)
      if (count <= 0) {
        return JSON.stringify({ success: true, loop: false, message: 'Loop / repeat has been turned off.' })
      }
      return JSON.stringify({
        success: true,
        loop: true,
        loopCount: count,
        message: count > 10 ? 'Loop enabled: track will repeat continuously.' : `Loop enabled: track will repeat ${count} time(s).`,
      })
    }

    case 'get_room_link': {
      return JSON.stringify({
        url: roomJoinUrl(groupId),
      })
    }

    case 'end_playback': {
      const ended = await roomManager.end(groupId, user.name, String(user.id))
      if (ended) stopRoomCard(targetChatId)
      return JSON.stringify({ success: ended, message: ended ? 'Playback stopped and room is now idle.' : 'Nothing was playing.' })
    }

    case 'set_room_mode': {
      const mode = String(args.mode || '').toLowerCase().trim() as RoomMode
      if (mode !== '2d' && mode !== '3d') {
        return JSON.stringify({
          success: false,
          error: 'invalid_mode',
          message: 'Valid modes are "2d" and "3d".',
        })
      }
      const current = await readRoomSettings(groupId)
      if (current.mode === mode) {
        return JSON.stringify({
          success: true,
          changed: false,
          mode,
          message: `The room is already set to ${mode.toUpperCase()} mode.`,
        })
      }
      await writeRoomMode(groupId, mode, String(user.id))
      return JSON.stringify({
        success: true,
        changed: true,
        mode,
        message: `Room mode set to ${mode.toUpperCase()}. Visitors will experience the room in ${mode.toUpperCase()} mode.`,
      })
    }

    case 'set_autoplay': {
      const next = Boolean(args.enabled)
      roomManager.setAutoplay(groupId, next)
      return JSON.stringify({
        success: true,
        autoplay: next,
        message: next
          ? 'Autoplay is now enabled for this room. Playeon will automatically queue recommended tracks when the queue finishes.'
          : 'Autoplay is now disabled for this room.',
      })
    }

    case 'set_room_style': {
      let style = String(args.style || '').toLowerCase().trim()
      if (style === 'midnight') style = 'default'
      if (!isRoomStyleId(style)) {
        return JSON.stringify({
          success: false,
          error: 'invalid_style',
          message: 'Available styles are: default (Midnight), poolrooms, halloween, and sushi.',
        })
      }
      const current = await readRoomSettings(groupId)
      if (current.style === style) {
        return JSON.stringify({
          success: true,
          changed: false,
          style,
          message: `The room theme is already set to "${style}".`,
        })
      }
      await writeRoomStyle(groupId, style, String(user.id))
      const styleInfo = styleById(style)
      return JSON.stringify({
        success: true,
        changed: true,
        style,
        label: styleInfo.label,
        blurb: styleInfo.blurb,
        message: `Room theme updated to ${styleInfo.label}: ${styleInfo.blurb}`,
      })
    }

    case 'save_memory': {
      const fact = String(args.fact || '').trim()
      if (!fact) {
        return JSON.stringify({ success: false, error: 'missing_fact', message: 'Please provide a valid memory fact to save.' })
      }
      const memories = await addUserMemory(user.id, fact)
      return JSON.stringify({
        success: true,
        action: 'saved_memory',
        fact,
        totalMemories: memories.length,
        message: `Remembered: "${fact}".`,
      })
    }

    case 'delete_memory': {
      const target = String(args.target || '').trim()
      if (!target) {
        return JSON.stringify({ success: false, error: 'missing_target', message: 'Please specify which memory to delete.' })
      }
      const res = await deleteUserMemory(user.id, target)
      return JSON.stringify({
        success: res.deleted,
        action: res.deleted ? 'deleted_memory' : 'not_found',
        message: res.deleted ? `Forgot memory related to "${target}".` : `No matching memory found for "${target}".`,
      })
    }

    case 'view_memories': {
      const data = await getUserMemoryData(user.id)
      return JSON.stringify({
        success: true,
        count: data.memories.length,
        memories: data.memories,
        summary: data.summary,
        message: data.memories.length > 0
          ? `Stored memories for ${user.name}:\n` + data.memories.map((m, i) => `${i + 1}. ${m}`).join('\n')
          : `No stored memories found for ${user.name} yet.`,
      })
    }

    default:
      return JSON.stringify({ success: false, error: 'unknown_tool', toolName })
  }
}
