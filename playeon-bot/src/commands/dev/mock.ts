import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { config } from '../../config.js'
import {
  INFO_EMOJI,
  WARNING_EMOJI,
  SUCCESS_EMOJI,
  ERROR_EMOJI,
} from '../../lib/feedback.js'
import {
  controlLine,
  nowPlayingCard,
  queuedCard,
  playlistQueuedCard,
  postponedCard,
  finishedCard,
  replayKeyboard,
  cancelKeyboard,
  lookupCard,
  downloadingCard,
  glyphProgressBar,
  premiumProgressBar,
  coverEmbed,
  type CardInfo,
} from '../../services/playback/playcard.js'
import { sendRichMessage } from '@mtcute/core/methods.js'
import { roomControlsKeyboard } from '../../services/room/roomLink.js'
import { queuedKeyboard } from '../../services/room/queuedCards.js'
import { notifyLevelUp } from '../../lib/ranking.js'
import {
  formatRecCard,
  makeRecKeyboard,
  renderRichRecommendationsHtml,
} from '../../services/playback/recommendationsCard.js'
import type { ResolvedTrack } from '../../services/media/musicSource.js'
import { sendGroupIntro } from '../../handlers/botJoinedChat.js'

const MOCK_RECOMMENDATIONS: ResolvedTrack[] = [
  {
    id: 'yPYZpwSpKmA',
    title: 'Together Forever (2022 Remaster)',
    uploader: 'Rick Astley',
    url: 'https://www.youtube.com/watch?v=yPYZpwSpKmA',
    duration: 204,
    artistAvatar: null,
    thumbnail: 'https://i.ytimg.com/vi/yPYZpwSpKmA/hqdefault.jpg',
  },
  {
    id: 'djV11Xbc914',
    title: 'Take On Me',
    uploader: 'a-ha',
    url: 'https://www.youtube.com/watch?v=djV11Xbc914',
    duration: 244,
    artistAvatar: null,
    thumbnail: 'https://i.ytimg.com/vi/djV11Xbc914/hqdefault.jpg',
  },
  {
    id: 'eNvUS-6PTbs',
    title: 'Cheri Cheri Lady',
    uploader: 'Modern Talking',
    url: 'https://www.youtube.com/watch?v=eNvUS-6PTbs',
    duration: 198,
    artistAvatar: null,
    thumbnail: 'https://i.ytimg.com/vi/eNvUS-6PTbs/hqdefault.jpg',
  },
  {
    id: 'Zi_XLOBDo_Y',
    title: 'Billie Jean',
    uploader: 'Michael Jackson',
    url: 'https://www.youtube.com/watch?v=Zi_XLOBDo_Y',
    duration: 296,
    artistAvatar: null,
    thumbnail: 'https://i.ytimg.com/vi/Zi_XLOBDo_Y/hqdefault.jpg',
  },
  {
    id: 'I_izvAbhExY',
    title: `Stayin' Alive (From "Saturday Night Fever" Soundtrack)`,
    uploader: 'Bee Gees',
    url: 'https://www.youtube.com/watch?v=I_izvAbhExY',
    duration: 250,
    artistAvatar: null,
    thumbnail: 'https://i.ytimg.com/vi/I_izvAbhExY/hqdefault.jpg',
  },
]

const AUDIO_SAMPLE: CardInfo = {
  title: 'Coldplay - Yellow (Official HD Video)',
  sourceUrl: 'https://www.youtube.com/watch?v=yKNxeF4KMsY',
  thumbnail: 'https://i.ytimg.com/vi/yKNxeF4KMsY/hqdefault.jpg',
  duration: 269,
  requestedBy: 'User',
  requestedById: 123456,
  video: false,
}

const VIDEO_SAMPLE: CardInfo = {
  title: 'Interstellar - Docking Scene (1080p 60fps)',
  sourceUrl: 'https://www.youtube.com/watch?v=a3lcGnMhvsA',
  thumbnail: 'https://i.ytimg.com/vi/a3lcGnMhvsA/hqdefault.jpg',
  duration: 245,
  requestedBy: 'User',
  requestedById: 123456,
  video: true,
  videoHeight: 1080,
}

export default defineCommand({
  name: 'mock',
  aliases: ['mocktest', 'testmock'],
  order: 44,
  description: 'Mock test all custom emojis: feedback, controls, cards, and levelup notifications.',
  usage: '/mock [feedback|controls|card|video|queue|pq|postponed|finished|download|levelup [N]|recrd|join]',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.USER, Role.ADMIN, Role.OWNER, Role.SUPERUSER, Role.DEV],

  handler: async (ctx) => {
    const mode = ctx.args[0]?.toLowerCase()
    const sender = ctx.msg.sender
    const chatId = String(ctx.msg.chat.id)

    const audioInfo: CardInfo = {
      ...AUDIO_SAMPLE,
      requestedBy: sender.displayName,
      requestedById: sender.id,
    }

    const videoInfo: CardInfo = {
      ...VIDEO_SAMPLE,
      requestedBy: sender.displayName,
      requestedById: sender.id,
    }

    // Feedback responses mock (4 actual bot feedback cases)
    if (mode === 'feedback' || !mode) {
      await ctx.msg.replyText(
        md`${INFO_EMOJI} Nothing is playing in the room right now.`,
      )
      await ctx.msg.replyText(
        md`${WARNING_EMOJI} Only video-chat admins or authorized users can control playback. Ask an admin to \`/auth\` you.`,
      )
      await ctx.msg.replyText(
        md`${SUCCESS_EMOJI} Added **${sender.displayName}** to authorized users.`,
      )
      await ctx.msg.replyText(
        md`${ERROR_EMOJI} Couldn't find anything matching your search.`,
      )
      if (mode === 'feedback') return
    }

    // Playback Control actions mock
    if (mode === 'controls' || !mode) {
      const pauseLine = controlLine({
        video: false,
        action: 'paused',
        name: sender.displayName,
        id: sender.id,
        youId: sender.id,
      })

      const resumeLine = controlLine({
        video: false,
        action: 'resumed',
        name: sender.displayName,
        id: sender.id,
        youId: sender.id,
      })

      const skipLine = controlLine({
        video: false,
        action: 'skipped',
        name: sender.displayName,
        id: sender.id,
        youId: sender.id,
      })

      const endLine = controlLine({
        video: false,
        action: 'ended',
        name: sender.displayName,
        id: sender.id,
        youId: sender.id,
      })

      const controlsSuite = md`**Mock Test: Playback Action Messages**

${pauseLine}
${resumeLine}
${skipLine}
${endLine}`

      await ctx.msg.replyText(controlsSuite, { disableWebPreview: true })
      if (mode === 'controls') return
    }

    // Audio Now Playing card with buttons mock
    if (mode === 'card' || !mode) {
      const embed = coverEmbed(audioInfo.thumbnail) && config.features.thumbnailEmbed
      await ctx.msg.replyText(nowPlayingCard(audioInfo, { you: String(sender.id) }), {
        replyMarkup: roomControlsKeyboard(chatId, false),
        invertMedia: embed,
        disableWebPreview: !embed,
      })
    }

    // Video Now Streaming card mock
    if (mode === 'video') {
      const embed = coverEmbed(videoInfo.thumbnail) && config.features.thumbnailEmbed
      await ctx.msg.replyText(nowPlayingCard(videoInfo, { you: String(sender.id) }), {
        replyMarkup: roomControlsKeyboard(chatId, false),
        invertMedia: embed,
        disableWebPreview: !embed,
      })
    }

    // Added to Queue card mock
    if (mode === 'queue' || mode === 'queued' || !mode) {
      await ctx.msg.replyText(
        queuedCard(audioInfo, 2, { where: 'room', you: String(sender.id) }),
        {
          replyMarkup: queuedKeyboard(chatId),
          disableWebPreview: true,
        },
      )
      if (mode === 'queue' || mode === 'queued') return
    }

    // Playlist Queue card mock
    if (mode === 'pq' || mode === 'playlist') {
      const playlistInfo = {
        title: 'Top Hits 2026 - Best Pop Music Playlist',
        sourceUrl: 'https://www.youtube.com/playlist?list=PLmock12345',
        trackCount: 15,
        totalDuration: 2845,
        requestedBy: sender.displayName,
        requestedById: sender.id,
        thumbnail: audioInfo.thumbnail,
      }
      await ctx.msg.replyText(
        playlistQueuedCard(playlistInfo, 3, { where: 'room', you: String(sender.id) }),
        {
          replyMarkup: queuedKeyboard(chatId),
          disableWebPreview: true,
        },
      )
      return
    }

    // Postponed card mock
    if (mode === 'postponed' || !mode) {
      await ctx.msg.replyText(
        postponedCard(audioInfo, {
          at: 85,
          name: sender.displayName,
          id: sender.id,
          youId: sender.id,
        }),
        { disableWebPreview: true },
      )
      if (mode === 'postponed') return
    }

    // Finished card mock
    if (mode === 'finished' || !mode) {
      await ctx.msg.replyText(
        finishedCard(audioInfo, String(sender.id)),
        {
          replyMarkup: replayKeyboard(),
          disableWebPreview: true,
        },
      )
      if (mode === 'finished') return
    }

    // Downloading card mock with [ ❌ Cancel ] button
    if (mode === 'download' || mode === 'downloading' || !mode) {
      const sub = ctx.args[1]?.toLowerCase()
      const title = md`**Downloading**\n[Mock Song](https://example.com) \`(3:45)\``
      if (sub === 'glyph') {
        await ctx.msg.replyText(
          md`${title}\n\n${glyphProgressBar(64)}`,
          { replyMarkup: cancelKeyboard(), disableWebPreview: true },
        )
      } else if (sub === 'premium') {
        await ctx.msg.replyText(
          md`${title}\n\n${premiumProgressBar(64)}`,
          { replyMarkup: cancelKeyboard(), disableWebPreview: true },
        )
      } else {
        await ctx.msg.replyText(
          downloadingCard(audioInfo, { percent: 64 }),
          {
            replyMarkup: cancelKeyboard(),
            disableWebPreview: true,
          },
        )
      }
      if (mode === 'download' || mode === 'downloading') return
    }

    // Level-up milestone notification mock
    if (mode === 'levelup' || mode === 'level' || !mode) {
      const levelArg = parseInt(ctx.args[1] ?? '8', 10)
      const targetLevel = isNaN(levelArg) || levelArg <= 0 ? 8 : levelArg
      await notifyLevelUp(
        ctx.msg.chat.id,
        sender.id,
        {
          username: sender.username ?? undefined,
          firstName: sender.displayName,
        },
        targetLevel,
      )
      if (mode === 'levelup' || mode === 'level') return
    }

    // Recommendations card mock with [1][2][3][4][5] and [Close]
    if (mode === 'recrd' || mode === 'rec' || mode === 'recommendations' || !mode) {
      const richHtml = renderRichRecommendationsHtml(
        audioInfo.title,
        audioInfo.sourceUrl,
        MOCK_RECOMMENDATIONS,
      )
      const replyMarkup = makeRecKeyboard('mock_session', MOCK_RECOMMENDATIONS.length)

      try {
        await sendRichMessage(ctx.tg, ctx.msg.chat.id, {
          replyTo: ctx.msg.id,
          content: {
            type: 'html',
            content: richHtml,
          },
          replyMarkup,
        })
      } catch {
        await ctx.msg.replyText(
          formatRecCard(audioInfo.title, audioInfo.sourceUrl, MOCK_RECOMMENDATIONS),
          {
            replyMarkup,
            disableWebPreview: true,
          },
        )
      }
      if (mode === 'recrd' || mode === 'rec' || mode === 'recommendations') return
    }

    // Group join / intro card mock
    if (mode === 'join' || mode === 'groupjoin' || mode === 'intro' || !mode) {
      const chatTitle = ('title' in ctx.msg.chat ? ctx.msg.chat.title : null) || 'Playeon Lounge'
      await sendGroupIntro(ctx.msg.chat.id, chatTitle, {
        firstName: sender.displayName,
        id: sender.id,
      })
      if (mode === 'join' || mode === 'groupjoin' || mode === 'intro') return
    }
  },
})
