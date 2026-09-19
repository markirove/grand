import { customEmoji } from '../../lib/emoji.js'
import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'
import type { User, Chat } from '@mtcute/node'
import { defineCommand, Role } from '../../core/command.js'
import { resolveTarget } from '../../lib/resolveTarget.js'
import { resolveRoleByIds } from '../../core/permissions.js'
import type { ResolvedRole } from '../../core/permissions.js'

type Line = TextWithEntities | null

const STATUS_LABEL: Record<string, string> = {
  online:        'Online now',
  offline:       'Last seen recently',
  recently:      'Last seen recently',
  within_week:   'Last seen within a week',
  within_month:  'Last seen within a month',
  long_time_ago: 'Last seen a long time ago',
  bot:           'Bot',
}

function join(...lines: Line[]): TextWithEntities {
  return lines
    .filter((l): l is TextWithEntities => l !== null)
    .reduce<TextWithEntities | null>((acc, l) => (acc ? md`${acc}\n${l}` : l), null) ?? md``
}

type MemberStatus = import('@mtcute/core').ChatMemberStatus | null

function formatUser(user: User, role: ResolvedRole | null, joinedDate?: Date | null, memberStatus?: MemberStatus): TextWithEntities {
  const username: Line = user.username ? md`**Username**: @${user.username}` : null
  const botLine: Line = null
  const status: Line = !user.isBot
    ? md`**Status**: ${STATUS_LABEL[user.status] ?? user.status}`
    : null
  const dc: Line = user.dcId ? md`**DC**: ${user.dcId}` : null
  const memberSince: Line = joinedDate
    ? md`**Joined**: ${joinedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : null

  const badges: TextWithEntities[] = []
  if (user.isBot)                                                    badges.push(md`${customEmoji('🤖', '6030400221232501136')} Bot`)
  if (role && (role.mask & Role.DEV))                               badges.push(md`${customEmoji('🔨', '5940433880585605708')} Developer`)
  if (role && (role.mask & Role.SUPERUSER))                         badges.push(md`${customEmoji('🔧', '5962952497197748583')} Superuser`)
  if (memberStatus === 'creator')                                    badges.push(md`${customEmoji('👑', '5805553606635559688')} Owner`)
  else if (memberStatus === 'admin')                                 badges.push(md`${customEmoji('👤', '5891207662678317861')} Admin`)
  if (user.isPremium)                                               badges.push(md`${customEmoji('⭐', '6028338546736107668')} Premium`)

  const header = md`${customEmoji('👤', '5904630315946611415')} **${user.displayName}**`
  const info   = join(md`**ID**: \`${String(user.id)}\``, username, botLine, status, dc, memberSince)

  if (badges.length === 0) return md`${header}\n${info}`

  const badgeBlock = badges.slice(1).reduce((acc, b) => md`${acc}\n${b}`, badges[0]!)
  return md`${header}\n${info}\n\n${badgeBlock}`
}

async function formatGroup(
  chat: Chat,
  tg: import('@mtcute/core/client.js').TelegramClient,
): Promise<TextWithEntities> {
  const typeLabel = chat.chatType === 'supergroup' ? 'Supergroup'
    : chat.chatType === 'channel' ? 'Channel'
    : 'Group'

  const username: Line = chat.username ? md`**Username**: @${chat.username}` : null

  let membersLine: Line = chat.membersCount != null
    ? md`**Members**: ${chat.membersCount.toLocaleString()}`
    : null
  let adminsLine: Line = null
  let bioLine: Line = null

  try {
    const full = await tg.getFullChat(chat.id)
    membersLine = md`**Members**: ${full.membersCount.toLocaleString()}`
    if (full.adminsCount) adminsLine = md`**Admins**: ${full.adminsCount}`
    if (full.bio) bioLine = md`${full.bio}`
  } catch {}

  const icon = chat.chatType === 'channel'
    ? customEmoji('📢', '6021418126061605425')
    : customEmoji('💭', '5904248647972820334')

  const header = md`${icon} **${chat.title}**`
  const info   = join(md`**ID**: \`${String(chat.id)}\``, md`**Type**: ${typeLabel}`, username, membersLine, adminsLine, bioLine)
  return md`${header}\n${info}`
}

export default defineCommand({
  name: 'info',
  order: 4,
  emoji: '🔍',
  emojiId: '6032850693348399258',
  description: 'Show info about a user or the current group.',
  usage: '/info [reply|@user|id]',
  category: 'general',
  contexts: 'any',
  reply: true,
  roles: [Role.USER],

  handler: async (ctx) => {
    const { msg, tg, args, reply } = ctx
    const chat = msg.chat

    if (chat.type === 'user') {
      const user = msg.sender
      if (user.type !== 'user') return
      await msg.answerText(formatUser(user, ctx.role))
      return
    }

    if (reply || args[0]) {
      const target = await resolveTarget(ctx)
      if (!target) {
        await msg.replyText('Could not resolve user. Reply to a message or provide an ID/@username.')
        return
      }
      const [targetRole, member] = await Promise.all([
        resolveRoleByIds(target.id, msg.chat.id, msg.chat),
        tg.getChatMember({ chatId: msg.chat.id, userId: target.id }).catch(() => null),
      ])
      const memberStatus = member?.status ?? null
      await msg.replyText(formatUser(target, targetRole, member?.joinedDate, memberStatus))
      return
    }

    await msg.replyText(await formatGroup(chat as Chat, tg))
  },
})
