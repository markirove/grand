import { md } from '@mtcute/markdown-parser'
import { BotKeyboard } from '@mtcute/node'
import type { Command, CommandCategory, CommandContextType } from './command.js'
import type { ResolvedRole } from './permissions.js'
import { hasRole, Role } from './permissions.js'
import { lines, paragraphs, joinMd } from '../lib/md.js'
import { botInfo } from '../client.js'
import { INLINE_COMMANDS } from '../services/room/inlineCommands.js'

const CATEGORY_ORDER: CommandCategory[] = ['playback', 'general', 'misc', 'dev']
const CATEGORY_LABEL: Record<CommandCategory, string> = {
  playback: 'Playback',
  general: 'General',
  misc: 'Misc',
  dev: 'Developer',
}

const PAGE_SIZE = 6

export type HelpGroup = 'personal' | 'groups' | 'inline' | 'channel'

const registry = new Map<CommandContextType, Command[]>()
const allCommandNames = new Set<string>()

export function registerCommand(context: CommandContextType, cmd: Command) {
  const list = registry.get(context) ?? []
  list.push(cmd)
  registry.set(context, list)
  allCommandNames.add(cmd.name.toLowerCase())
  for (const a of cmd.aliases ?? []) allCommandNames.add(a.toLowerCase())
}

export function isKnownCommand(word: string): boolean {
  return allCommandNames.has(word.trim().toLowerCase())
}

export function visibleCommands(context: CommandContextType, role: ResolvedRole): Command[] {
  const contexts: CommandContextType[] = [context, 'any']
  if (context !== 'dev' && context !== 'superuser') {
    contexts.push('dev', 'superuser')
  }

  const cmds: Command[] = []
  for (const ctx of contexts) {
    for (const cmd of registry.get(ctx) ?? []) {
      if (cmd.hidden) continue
      if (cmd.hiddenFromBelow !== false && !hasRole(role, cmd.roles)) continue
      cmds.push(cmd)
    }
  }
  return cmds.sort(byDisplayOrder)
}

const PRIVILEGED = Role.SUPERUSER | Role.DEV

function docVisible(cmd: Command, role: ResolvedRole): boolean {
  if (cmd.hidden) return false
  const privilegedOnly = cmd.roles.every((r) => (r & PRIVILEGED) !== 0)
  if (privilegedOnly && !hasRole(role, cmd.roles)) return false
  return true
}

function byDisplayOrder(a: Command, b: Command): number {
  return a.name.localeCompare(b.name)
}

const ALL_CONTEXTS: CommandContextType[] = [
  'private', 'bot', 'group', 'supergroup', 'any', 'channel', 'dev', 'superuser',
]

function allDocCommands(role: ResolvedRole): Command[] {
  const seen = new Set<string>()
  const cmds: Command[] = []
  for (const ctx of ALL_CONTEXTS) {
    for (const cmd of registry.get(ctx) ?? []) {
      if (!docVisible(cmd, role)) continue
      if (seen.has(cmd.name)) continue
      seen.add(cmd.name)
      cmds.push(cmd)
    }
  }
  return cmds.sort(byDisplayOrder)
}

function commandCodeBlock(usage: string, description: string): ReturnType<typeof md> {
  return md('```' + usage + '\n' + description + '\n```')
}

function formatUsage(cmd: Command, prefix: string): string {
  return cmd.usage
    .replace(/^\//, prefix)
    .replace(/<([^>]+)>/g, '[$1]')
}

function commandLabel(name: string): string {
  const labels: Record<string, string> = {
    vplay: 'Video Play',
    bw: 'Rewind',
    fw: 'Fast Forward',
    ch: 'Channel',
    unch: 'Unchannel',
    authusers: 'Authorized Users',
    addsuperuser: 'Add Superuser',
    delsuperuser: 'Remove Superuser',
    groupslist: 'Groups List',
    userslist: 'Users List',
    setbanner: 'Set Banner',
    resetrank: 'Reset Rank',
  }
  return labels[name] ?? `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`
}

type Rendered = {
  text: ReturnType<typeof md>
  replyMarkup: ReturnType<typeof BotKeyboard.inline>
}

export type Origin = { id: number; from: 'cmd' | 'start' }

export const NO_ORIGIN: Origin = { id: 0, from: 'cmd' }
const tag = (o: Origin) => `${o.id}:${o.from === 'start' ? 's' : 'c'}`

export function parseOrigin(id: string | undefined, from: string | undefined): Origin {
  return { id: Number(id) || 0, from: from === 's' ? 'start' : 'cmd' }
}

const closeButton = (origin: Origin) => BotKeyboard.callback('Close', `help:close:${origin.id}`)
const backToMenu = (origin: Origin) => BotKeyboard.callback('Back', `help:menu:${tag(origin)}`)

const exitButton = (origin: Origin) =>
  origin.from === 'start' && origin.id
    ? BotKeyboard.callback('Back', `help:start:${origin.id}`)
    : closeButton(origin)

export function renderHelpOverview(
  role: ResolvedRole,
  origin: Origin = NO_ORIGIN,
): Rendered {
  const isDev = (role.mask & (Role.DEV | Role.SUPERUSER)) !== 0
  const sections: { key: string; label: string }[] = [
    { key: 'playback', label: 'Playback' },
    { key: 'general', label: 'General' },
    { key: 'inline', label: 'Inline Guide' },
    { key: 'misc', label: 'Misc' },
  ]
  if (isDev) {
    sections.push({ key: 'dev', label: 'Developer' })
  }

  const text = paragraphs(
    md`**Commands Guide**`,
    md`Select a category below to view commands, or send /help [command] for instant details.`,
  )

  const rows: ReturnType<typeof BotKeyboard.callback>[][] = []
  for (let i = 0; i < sections.length; i += 2) {
    rows.push(
      sections.slice(i, i + 2).map((s) =>
        s.key === 'inline'
          ? BotKeyboard.callback(s.label, `help:inline:${tag(origin)}`)
          : BotKeyboard.callback(s.label, `help:cat:${s.key}:0:${tag(origin)}`),
      ),
    )
  }
  rows.push([exitButton(origin)])

  return { text, replyMarkup: BotKeyboard.inline(rows) }
}

export function renderHelpCategory(
  category: CommandCategory,
  role: ResolvedRole,
  prefix: string,
  page = 0,
  origin: Origin = NO_ORIGIN,
): Rendered {
  const allCmds = allDocCommands(role)
  const cmds = allCmds
    .filter((c) => (c.category ?? 'general') === category)
    .sort(byDisplayOrder)

  if (cmds.length === 0) {
    return {
      text: paragraphs(
        md`**${CATEGORY_LABEL[category]} Commands**`,
        md`No commands available in this section.`,
      ),
      replyMarkup: BotKeyboard.inline([[backToMenu(origin)]]),
    }
  }

  const pageCount = Math.ceil(cmds.length / PAGE_SIZE)
  const current = Math.min(Math.max(page, 0), pageCount - 1)
  const slice = cmds.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  const codeBlocks = lines(
    ...slice.map((c) => {
      const usage = formatUsage(c, prefix)
      const desc = c.summary ?? c.description
      return commandCodeBlock(usage, desc)
    }),
  )

  const heading = pageCount > 1
    ? md`**${CATEGORY_LABEL[category]} Commands** (${String(current + 1)}/${String(pageCount)})`
    : md`**${CATEGORY_LABEL[category]} Commands**`

  const text = paragraphs(
    heading,
    codeBlocks,
    md`Send ${prefix}help [command] for full details on any command.`,
  )

  const rows: ReturnType<typeof BotKeyboard.callback>[][] = []

  if (pageCount > 1) {
    const prev = (current - 1 + pageCount) % pageCount
    const next = (current + 1) % pageCount
    rows.push([
      BotKeyboard.callback('‹ Prev', `help:cat:${category}:${prev}:${tag(origin)}`),
      BotKeyboard.callback(`${current + 1}/${pageCount}`, 'help:noop'),
      BotKeyboard.callback('Next ›', `help:cat:${category}:${next}:${tag(origin)}`),
    ])
  }

  rows.push([backToMenu(origin)])

  return {
    text,
    replyMarkup: BotKeyboard.inline(rows),
  }
}

export function renderInlineGuide(origin: Origin = NO_ORIGIN): Rendered {
  const at = botInfo.username ? `@${botInfo.username}` : '@PlayeonBot'

  const searchBlock = commandCodeBlock(`${at} [song or video]`, 'Search and share music/video in any chat')
  const inviteBlock = commandCodeBlock(`${at} /invite`, 'Share a direct invite link to your room')

  const controlBlocks = lines(
    ...INLINE_COMMANDS.map((c) => commandCodeBlock(`${at} /${c.name}`, c.description)),
  )

  const text = paragraphs(
    md`**Inline Controls Guide**`,
    md`Search or control playback from any chat without adding the bot.`,
    lines(searchBlock, inviteBlock),
    md`**Quick Controls:**`,
    controlBlocks,
  )

  return {
    text,
    replyMarkup: BotKeyboard.inline([[backToMenu(origin)]]),
  }
}

export function renderCommandDetail(
  role: ResolvedRole,
  prefix: string,
  cmd: Command,
  origin: Origin = NO_ORIGIN,
): Rendered {
  const usage = formatUsage(cmd, prefix)
  const aliases = cmd.aliases?.length
    ? lines(md`**Aliases:** ${joinMd(', ', cmd.aliases.map((a) => md`\`${prefix}${a}\``))}`)
    : null

  const codeCard = commandCodeBlock(usage, cmd.summary ?? cmd.description)

  const text = paragraphs(
    md`**${commandLabel(cmd.name)}**`,
    codeCard,
    aliases,
    md`**Details:**\n${cmd.description}`,
  )

  const category = cmd.category ?? 'general'
  const back = BotKeyboard.callback('Back', `help:cat:${category}:0:${tag(origin)}`)

  return {
    text,
    replyMarkup: BotKeyboard.inline([[back]]),
  }
}

export function findCategory(query: string): CommandCategory | null {
  const q = query.trim().toLowerCase()
  return CATEGORY_ORDER.find((cat) => cat === q) ?? null
}

export function findCommand(
  role: ResolvedRole,
  query: string,
): Command | null {
  const q = query.trim().toLowerCase().replace(/^\//, '')
  const cmds = allDocCommands(role)
  return cmds.find((c) => c.name === q || c.aliases?.includes(q)) ?? null
}

export { CATEGORY_ORDER, CATEGORY_LABEL }
