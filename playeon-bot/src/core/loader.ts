import { customEmoji } from '../lib/emoji.js'
import { md } from '@mtcute/markdown-parser'
import { readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { filters } from '@mtcute/dispatcher'
import type { MessageContext } from '@mtcute/dispatcher'
import type { User, Chat } from '@mtcute/node'
import { dp, botInfo } from '../client.js'
import { config } from '../config.js'
import { prefixCommand } from './prefixFilter.js'
import { resolveRole, hasRole, hasChatAdminRights, ADMIN_RIGHT_LABEL, Role, type RoleMask } from './permissions.js'
import { getPrefix } from './prefix.js'
import { registerCommand } from './help.js'
import { touchUserActive, touchGroupActive } from '../services/stats.js'
import type { Command, CommandContext, CommandContextType } from './command.js'

function resolveChatContext(msg: MessageContext): CommandContextType {
  if (msg.chat.type === 'user') return 'private'
  const chat = msg.chat as Chat
  switch (chat.chatType) {
    case 'group':      return 'group'
    case 'supergroup': return 'supergroup'
    case 'channel':    return 'channel'
    default:           return 'any'
  }
}

function makeMultiContextFilter(
  contexts: CommandContextType[] | 'any' | undefined,
): ((msg: MessageContext) => boolean) | null {
  if (!contexts || contexts === 'any') return null
  const list = Array.isArray(contexts) ? contexts : [contexts]
  if (list.includes('any') || list.includes('dev') || list.includes('superuser')) {
    return null
  }

  return (msg: MessageContext) => {
    if (msg.chat.type === 'user') {
      return list.includes('private') || (list.includes('bot') && (msg.chat as User).isBot)
    }
    const chat = msg.chat as Chat
    return list.includes(chat.chatType as CommandContextType)
  }
}

function applyReplyMode(msg: MessageContext): void {
  type AnyFn = (...args: unknown[]) => unknown
  const m = msg as unknown as Record<string, AnyFn>
  const replyText = msg.replyText.bind(msg) as AnyFn
  const replyMedia = msg.replyMedia.bind(msg) as AnyFn
  const replyMediaGroup = msg.replyMediaGroup.bind(msg) as AnyFn
  m.answerText = (...a) => replyText(...a)
  m.answerMedia = (...a) => replyMedia(...a)
  m.answerMediaGroup = (...a) => replyMediaGroup(...a)
}

function roleAudience(roles: RoleMask[]): string {
  const has = (r: RoleMask): boolean => roles.some((x) => (x & r) !== 0)
  if (has(Role.USER)) return 'everyone'
  if (has(Role.ADMIN)) return 'group admins, the owner, and bot superusers'
  if (has(Role.OWNER)) return 'the group owner and bot superusers'
  if (has(Role.SUPERUSER)) return 'bot superusers and developers'
  if (has(Role.DEV)) return 'bot developers'
  return 'authorized users'
}

function buildWrappedHandler(cmd: Command) {
  return async (msg: MessageContext) => {
    if (cmd.reply) applyReplyMode(msg)

    const rawMsg = msg as MessageContext & { command: string[] }
    const commandArr = rawMsg.command ?? [cmd.name]
    const args = commandArr.slice(1)
    const rawArgs = args.join(' ')

    const role = await resolveRole(msg)

    if (config.devMode && !(role.mask & (Role.DEV | Role.SUPERUSER))) return

    if (!hasRole(role, cmd.roles)) {
      await msg.replyText(md`${customEmoji('❗️', '6030563507299160824')} You don't have permission to use \`${msg.chat.type === 'user' ? '/' : ''}${cmd.name}\`. It's limited to ${roleAudience(cmd.roles)}.`)
      return
    }

    if (cmd.permissions?.chatAdminRights?.length && msg.chat.type !== 'user') {
      const rightsCheck = hasChatAdminRights(role, cmd.permissions.chatAdminRights)
      if (!rightsCheck.ok) {
        const fragments = rightsCheck.missing.map(r => md`**${ADMIN_RIGHT_LABEL[r]}**`)
        const list = fragments.length === 1
          ? fragments[0]!
          : fragments.reduce((acc, f, i) => {
              if (i === fragments.length - 1) return md`${acc} and ${f}`
              return md`${acc}, ${f}`
            })
        const s = rightsCheck.missing.length > 1 ? 's' : ''
        await msg.replyText(md`${customEmoji('❗️', '6030563507299160824')} You can't use \`${cmd.name}\` - it needs the ${list} admin right${s}. Ask a group owner to grant it (or run it as the owner / a bot superuser).`)
        return
      }
    }

    let reply = null
    if (cmd.requiresReply) {
      reply = await msg.getReplyTo()
      if (!reply) return
    } else {
      try { reply = await msg.getReplyTo() } catch {}
    }

    const prefix = msg.chat.type === 'user'
      ? '/'
      : await getPrefix(msg.chat.id)

    const context = resolveChatContext(msg)

    const ctx: CommandContext = {
      msg,
      tg: msg.client,
      args,
      rawArgs,
      reply,
      role,
      prefix,
      context,
      db: dp.deps.db,
      cache: dp.deps.cache,
      logger: dp.deps.logger,
    }

    if (cmd.permissions?.custom) {
      const allowed = await cmd.permissions.custom(ctx)
      if (!allowed) return
    }

    /*
      Both halves register the peer if the database has never seen it.
    */
    if (msg.sender.type === 'user') {
      touchUserActive(msg.sender, { started: msg.chat.type === 'user' })
    }
    if (msg.chat.type !== 'user') touchGroupActive(msg.chat)

    try {
      await cmd.handler(ctx)
    } catch (err) {
      dp.deps.logger.commandError(cmd.name, err, msg.chat.id)
      console.error(`[${cmd.name}]`, err)
    }
  }
}

export async function loadCommands() {
  const srcDir = new URL('../../src/commands/', import.meta.url)
  const commandsDir = new URL(srcDir).pathname

  let entries: string[]
  try {
    entries = await readdir(commandsDir, { recursive: true })
  } catch (err) {
    console.error('[loader] failed to read commands directory:', err)
    return
  }

  const tsFiles = entries.filter(
    (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts') && !path.basename(f).startsWith('_'),
  )

  for (const file of tsFiles) {
    const filePath = path.join(commandsDir, file)
    const fileUrl = pathToFileURL(filePath).href

    const mod = await import(fileUrl) as { default?: Command }
    const cmd = mod.default
    if (!cmd || cmd.disabled) continue

    cmd.__filePath = filePath

    const targetContexts: CommandContextType[] =
      !cmd.contexts || cmd.contexts === 'any'
        ? ['any']
        : Array.isArray(cmd.contexts)
          ? cmd.contexts
          : [cmd.contexts]

    for (const ctx of targetContexts) {
      registerCommand(ctx, cmd)
    }

    const cmdFilter = prefixCommand(
      cmd.name,
      cmd.aliases ?? [],
      () => botInfo.username,
    )

    const wrappedHandler = buildWrappedHandler(cmd)
    const contextFilter = makeMultiContextFilter(cmd.contexts)

    if (contextFilter) {
      dp.onNewMessage(filters.and(contextFilter, cmdFilter), wrappedHandler)
    } else {
      dp.onNewMessage(cmdFilter, wrappedHandler)
    }
  }

  console.log('[loader] commands loaded')
}
