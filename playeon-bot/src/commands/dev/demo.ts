import { md } from '@mtcute/markdown-parser'
import { defineCommand, Role } from '../../core/command.js'
import { config } from '../../config.js'
import {
  cancelKeyboard,
  coverEmbed,
  downloadingCard,
  inlineLookupCard,
  lookupCard,
  type CardInfo,
} from '../../services/playback/playcard.js'
import { joinRoomKeyboard } from '../../services/room/roomLink.js'
import { roomManager } from '../../services/room/RoomManager.js'

/**
 * A track that does not exist, with everything a real one has.
 *
 * Real-looking rather than obviously fake: a title long enough to show how the
 * card handles a long title, a page to link to, a thumbnail so the cover embed
 * is exercised, and a duration that is not a round number. A demo built from
 * `'test'` and `1:00` tells you nothing about the thing you are looking at.
 */
const SAMPLE = {
  title: 'Fleetwood Mac - Dreams (Official Music Video Remaster)',
  sourceUrl: 'https://www.youtube.com/watch?v=mrZRURcb1cM',
  thumbnail: 'https://i.ytimg.com/vi/mrZRURcb1cM/hqdefault.jpg',
  duration: 257,
} as const

const WHAT = ['join', 'lookup', 'inline', 'download'] as const
type What = (typeof WHAT)[number]

export default defineCommand({
  name: 'demo',
  order: 43,
  description: 'Preview the cards the bot sends: the join notice, the lookup cards and the download card.',
  usage: '/demo [join|lookup|inline|download]',
  category: 'dev',
  contexts: 'any',
  reply: true,
  roles: [Role.DEV],
  hidden: true,

  handler: async (ctx) => {
    const roomId = String(ctx.msg.chat.id)
    const sender = ctx.msg.sender
    const asked = ctx.args[0]?.toLowerCase()
    const want: What[] = WHAT.includes(asked as What) ? [asked as What] : [...WHAT]

    const info: CardInfo = {
      ...SAMPLE,
      requestedBy: sender.displayName,
      requestedById: sender.id,
      video: true,
    }

    for (const card of want) {
      if (card === 'join') {
        /*
          Rendered against the live room, with you as the person who walked in.

          Not a mock, unlike the rest of these: it reads the room that is
          actually there, so what it says about the track and the people in it
          is true. In a room nobody has opened it falls back to the empty state,
          which is the other half of what needs checking.
        */
        const text = await roomManager.previewJoinNotice(roomId, {
          id: String(sender.id),
          name: sender.displayName,
        })
        const inside = roomManager.isPresent(roomId, String(sender.id))
        await ctx.msg.replyText(text, {
          replyMarkup: inside ? undefined : joinRoomKeyboard(roomId),
          disableWebPreview: true,
        })
        continue
      }

      if (card === 'lookup') {
        await ctx.msg.replyText(lookupCard('dreams fleetwood mac'), {
          replyMarkup: cancelKeyboard(),
          disableWebPreview: true,
        })
        continue
      }

      if (card === 'inline') {
        await ctx.msg.replyText(
          inlineLookupCard(SAMPLE.title, SAMPLE.sourceUrl),
          { replyMarkup: joinRoomKeyboard(roomId), disableWebPreview: true },
        )
        continue
      }

      /*
        Sent the way the real one is, cover and all.

        The download card carries its thumbnail as an invisible link and relies
        on `invertMedia` to put the preview above the text. Sending it with the
        preview switched off would show the layout without the picture, which is
        most of what there is to look at.
      */
      const embed = coverEmbed(SAMPLE.thumbnail) && config.features.thumbnailEmbed
      await ctx.msg.replyText(downloadingCard(info, { percent: 62 }), {
        replyMarkup: cancelKeyboard(),
        invertMedia: embed,
        disableWebPreview: !embed,
      })
    }

    if (want.length === WHAT.length) {
      await ctx.msg.replyText(
        md`Above: the join notice, the search lookup, the inline lookup and the download card at 62%. Pass one of \`join\`, \`lookup\`, \`inline\` or \`download\` to see just that one.`,
      )
    }
  },
})
