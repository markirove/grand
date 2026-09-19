import type { Chat, User } from '@mtcute/node'
import { collections } from './mongo.js'
import { config } from '../config.js'
import type { ChatDoc } from '../models/chat.js'
import { periodStart } from '../lib/ranking.js'

const GROUP_TYPES = { $in: ['group', 'supergroup'] as const }

const STARTED = { startedAt: { $exists: true } }

export function recordTrackPlayed(): void {
  void collections.playEvents.insertOne({ at: new Date() }).catch(() => {})
}

/**
 * Record that a user is active, creating the row when it is missing.
 *
 * These used to be plain updates, which matched nothing for a user the database
 * had never heard of - fine when the collection was complete, useless after it
 * was lost. Upserting instead rebuilds the user base out of ordinary traffic:
 * whoever still uses the bot writes themselves back in on their next command.
 *
 * `started` means the interaction proves this user has a private chat with the
 * bot, which is what `startedAt` records and what `/broadcast` selects on. A
 * command in DM proves it; an inline query does not, since inline works without
 * ever having started the bot.
 */
async function recordUser(user: User, started: boolean): Promise<void> {
  const now = new Date()

  await collections.users.updateOne(
    { _id: String(user.id) },
    {
      $setOnInsert: { firstSeenAt: now, recoveredAt: now },
      $set: {
        lastSeenAt: now,
        ...(user.username ? { username: user.username } : {}),
        ...(user.firstName ? { firstName: user.firstName } : {}),
        ...(user.lastName ? { lastName: user.lastName } : {}),
      },
    },
    { upsert: true },
  )

  /*
    `startedAt` is deliberately not part of the insert above.

    A row can already exist without it - `recordMessage` creates one from any
    group message - and such a user is just as invisible to broadcast as a
    missing row is, so `$setOnInsert` would leave the more common case
    unrepaired. The guarded update covers both, and never overwrites a genuine
    start date. It runs after the upsert so the row is there to match.
  */
  if (started) {
    await collections.users.updateOne(
      { _id: String(user.id), startedAt: { $exists: false } },
      { $set: { startedAt: now } },
    )
  }
}

export function touchUserActive(user: User, opts: { started?: boolean } = {}): void {
  if (user.isBot) return
  void recordUser(user, opts.started ?? false).catch(() => {})
}

/** `ChatDoc.type` is narrower than mtcute's - fold the variants it doesn't model. */
function chatDocType(chat: Chat): ChatDoc['type'] | null {
  switch (chat.chatType) {
    case 'group':
    case 'supergroup':
    case 'channel':
      return chat.chatType
    // a gigagroup is a supergroup that outgrew the member cap; same thing here
    case 'gigagroup':
      return 'supergroup'
    default:
      return null
  }
}

/**
 * Record that a chat is active, creating the row when it is missing.
 *
 * The counterpart to `recordUser` for the other half of the lost data. `type`
 * matters as much as the row itself: `/stats` and the admin lists select groups
 * by it, so a row without one is invisible even though it exists.
 */
export function touchGroupActive(chat: Chat): void {
  const type = chatDocType(chat)
  if (!type) return

  const now = new Date()
  void collections.chats
    .updateOne(
      { _id: String(chat.id) },
      {
        $setOnInsert: { prefix: config.defaultPrefix, addedAt: now, recoveredAt: now },
        $set: { title: chat.title, type, lastActiveAt: now },
      },
      { upsert: true },
    )
    .catch(() => {})
}

export type AnalyticsWindow = 'today' | 'week' | 'month' | 'overall'

export const WINDOW_LABEL: Record<AnalyticsWindow, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  overall: 'Overall',
}

function windowStart(window: AnalyticsWindow): Date | null {
  return window === 'overall' ? null : periodStart(window)
}

export type AnalyticsCounts = {
  tracksPlayed: number
  usersStarted: number
  groupsAdded: number
}

export async function analytics(window: AnalyticsWindow): Promise<AnalyticsCounts> {
  const from = windowStart(window)
  const range = from ? { $gte: from } : undefined

  const [tracksPlayed, usersStarted, groupsAdded] = await Promise.all([
    collections.playEvents.countDocuments(range ? { at: range } : {}),
    collections.users.countDocuments(range ? { startedAt: range } : STARTED),
    collections.chats.countDocuments(
      range ? { addedAt: range, type: GROUP_TYPES } : { type: GROUP_TYPES },
    ),
  ])

  return { tracksPlayed, usersStarted, groupsAdded }
}

export async function totals(): Promise<{ users: number; groups: number }> {
  const [users, groups] = await Promise.all([
    collections.users.countDocuments(STARTED),
    collections.chats.countDocuments({ type: GROUP_TYPES }),
  ])
  return { users, groups }
}
