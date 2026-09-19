import { md } from '@mtcute/markdown-parser'
import { tg } from '../client.js'
import { config } from '../config.js'
import { collections } from '../services/mongo.js'
import { levelFromXp } from './leveling.js'
import { PARTY_EMOJI_ID } from './emoji.js'
import { isEmojiInvalid } from './tgErrors.js'

export type Period = 'today' | 'week' | 'month' | 'overall'

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  overall: 'Overall',
}

export function isPeriod(x: string): x is Period {
  return x === 'today' || x === 'week' || x === 'month' || x === 'overall'
}

function utcDayStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function periodStart(period: Period, now = new Date()): Date {
  const day = startOfUtcDay(now)
  switch (period) {
    case 'today':
      return day
    case 'week': {
      const dow = (now.getUTCDay() + 6) % 7
      return new Date(day.getTime() - dow * 86400_000)
    }
    case 'month':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    case 'overall':
      return new Date(0)
  }
}

export function shouldNotifyLevel(level: number): boolean {
  if (level <= 0) return false
  if (level <= 5) return true
  return level % 5 === 0
}

export function getNotifiableMilestone(prevLevel: number, newLevel: number): number | null {
  if (newLevel <= prevLevel) return null
  for (let lvl = newLevel; lvl > prevLevel; lvl--) {
    if (shouldNotifyLevel(lvl)) {
      return lvl
    }
  }
  return null
}

export async function notifyLevelUp(
  groupId: number,
  userId: number,
  profile: { username?: string; firstName?: string; lastName?: string },
  newLevel: number,
): Promise<void> {
  const displayName = profile.firstName || profile.username || `User ${userId}`
  const party = config.features.emoji ? md`[🎉](tg://emoji?id=${PARTY_EMOJI_ID})` : md`🎉`
  const text = md`${party} Congrats [**${displayName}**](tg://user?id=${userId})! You reached **Level ${newLevel}**.`

  try {
    await tg.sendText(groupId, text)
  } catch (err) {
    if (isEmojiInvalid(err)) {
      await tg.sendText(groupId, md`🎉 Congrats [**${displayName}**](tg://user?id=${userId})! You reached **Level ${newLevel}**.`).catch(() => {})
    } else {
      console.error(`[ranking] Failed to send level up notification to chat ${groupId}:`, err)
    }
  }
}

export type TrackListenResult = {
  counted: boolean
  totalTracks: number
  totalSeconds: number
  level: number
  milestoneLevel?: number | null
}

export type RecordTrackListenOpts = {
  isRequester?: boolean
}

/**
 * Record a qualified track listen/watch.
 * - Requesters get credited with tracks played (+1) and watch time.
 * - Spectators/listeners present in the room for >= 50% get credited with watch time (+seconds).
 */
export async function recordTrackListen(
  groupId: number,
  userId: number,
  track: { id: string; title: string; duration?: number | null },
  listenedSec: number,
  profile: { username?: string; firstName?: string; lastName?: string },
  opts: RecordTrackListenOpts = { isRequester: true },
  now = new Date(),
): Promise<TrackListenResult> {
  const day = utcDayStr(now)
  const dayStart = startOfUtcDay(now)
  const sec = Math.max(0, Math.round(listenedSec))
  const tracksInc = 1

  await Promise.all([
    collections.listenStats.updateOne(
      { _id: `${groupId}:${userId}:${day}` },
      {
        $setOnInsert: { groupId, userId, day, dayStart },
        $inc: { tracksCount: tracksInc, secondsCount: sec },
        $set: { updatedAt: now },
      },
      { upsert: true },
    ),
    collections.memberListenStats.updateOne(
      { _id: `${groupId}:${userId}` },
      {
        $setOnInsert: { groupId, userId, firstListenedAt: now },
        $inc: { tracksCount: tracksInc, secondsCount: sec },
        $set: { lastListenedAt: now },
      },
      { upsert: true },
    ),
  ])

  const updated = await collections.users.findOneAndUpdate(
    { _id: String(userId) },
    {
      $inc: { totalTracksListened: tracksInc, totalSecondsListened: sec },
      $set: {
        lastSeenAt: now,
        ...(profile.username !== undefined ? { username: profile.username } : {}),
        ...(profile.firstName !== undefined ? { firstName: profile.firstName } : {}),
        ...(profile.lastName !== undefined ? { lastName: profile.lastName } : {}),
      },
      $setOnInsert: { firstSeenAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  )

  const totalTracks = updated?.totalTracksListened ?? tracksInc
  const totalSeconds = updated?.totalSecondsListened ?? sec
  const level = levelFromXp(totalTracks)

  const prevTotalTracks = Math.max(0, totalTracks - tracksInc)
  const prevLevel = levelFromXp(prevTotalTracks)
  const milestoneLevel = tracksInc > 0 ? getNotifiableMilestone(prevLevel, level) : null

  if ((updated?.level ?? -1) !== level) {
    await collections.users.updateOne({ _id: String(userId) }, { $set: { level } })
  }

  return { counted: true, totalTracks, totalSeconds, level, milestoneLevel }
}

export type RankEntry = {
  userId: number
  count: number // total tracks listened / played
  seconds: number // total seconds listened / watched
}

export async function leaderboard(
  period: Period,
  limit: number,
  groupId?: number,
  now = new Date(),
): Promise<RankEntry[]> {
  if (period === 'overall') {
    if (groupId !== undefined) {
      const rows = await collections.memberListenStats
        .find({
          groupId,
          $or: [{ tracksCount: { $gt: 0 } }, { secondsCount: { $gt: 0 } }],
        })
        .sort({ tracksCount: -1, secondsCount: -1, userId: 1 })
        .limit(limit)
        .toArray()
      return rows.map((r) => ({
        userId: r.userId,
        count: r.tracksCount ?? 0,
        seconds: r.secondsCount ?? 0,
      }))
    } else {
      const rows = await collections.users
        .find({
          $or: [{ totalTracksListened: { $gt: 0 } }, { totalSecondsListened: { $gt: 0 } }],
        })
        .sort({ totalTracksListened: -1, totalSecondsListened: -1, _id: 1 })
        .limit(limit)
        .toArray()
      return rows.map((r) => ({
        userId: Number(r._id),
        count: r.totalTracksListened ?? 0,
        seconds: r.totalSecondsListened ?? 0,
      }))
    }
  }

  const match: Record<string, unknown> = {
    dayStart: { $gte: periodStart(period, now) },
    $or: [{ tracksCount: { $gt: 0 } }, { secondsCount: { $gt: 0 } }],
  }
  if (groupId !== undefined) match['groupId'] = groupId

  const rows = await collections.listenStats
    .aggregate<{ _id: number; count: number; seconds: number }>([
      { $match: match },
      {
        $group: {
          _id: '$userId',
          count: { $sum: '$tracksCount' },
          seconds: { $sum: '$secondsCount' },
        },
      },
      { $sort: { count: -1, seconds: -1, _id: 1 } },
      { $limit: limit },
    ])
    .toArray()

  return rows.map((r) => ({
    userId: r._id,
    count: r.count,
    seconds: r.seconds ?? 0,
  }))
}

export async function periodTotal(
  period: Period,
  groupId?: number,
  now = new Date(),
): Promise<number> {
  if (period === 'overall') {
    if (groupId !== undefined) {
      const rows = await collections.memberListenStats
        .aggregate<{ total: number }>([
          { $match: { groupId, tracksCount: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: '$tracksCount' } } },
        ])
        .toArray()
      return rows[0]?.total ?? 0
    } else {
      const rows = await collections.users
        .aggregate<{ total: number }>([
          { $match: { totalTracksListened: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: '$totalTracksListened' } } },
        ])
        .toArray()
      return rows[0]?.total ?? 0
    }
  }

  const match: Record<string, unknown> = { dayStart: { $gte: periodStart(period, now) } }
  if (groupId !== undefined) match['groupId'] = groupId

  const rows = await collections.listenStats
    .aggregate<{ total: number }>([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$tracksCount' } } },
    ])
    .toArray()
  return rows[0]?.total ?? 0
}

export async function periodCount(
  period: Period,
  userId: number,
  groupId?: number,
  now = new Date(),
): Promise<number> {
  const match: Record<string, unknown> = {
    userId,
    dayStart: { $gte: periodStart(period, now) },
  }
  if (groupId !== undefined) match['groupId'] = groupId

  const rows = await collections.listenStats
    .aggregate<{ total: number }>([
      { $match: match },
      { $group: { _id: null, total: { $sum: '$tracksCount' } } },
    ])
    .toArray()
  return rows[0]?.total ?? 0
}

export async function periodRank(
  period: Period,
  userId: number,
  groupId?: number,
  now = new Date(),
): Promise<number> {
  if (period === 'overall') {
    if (groupId !== undefined) {
      return groupAllTimeRank(groupId, userId)
    }
    return globalAllTimeRank(userId)
  }

  const match: Record<string, unknown> = {
    userId,
    dayStart: { $gte: periodStart(period, now) },
  }
  if (groupId !== undefined) match['groupId'] = groupId

  const myStats = await collections.listenStats
    .aggregate<{ count: number; seconds: number }>([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: '$tracksCount' },
          seconds: { $sum: '$secondsCount' },
        },
      },
    ])
    .toArray()

  const myCount = myStats[0]?.count ?? 0
  const mySeconds = myStats[0]?.seconds ?? 0
  if (myCount <= 0 && mySeconds <= 0) return 0

  const periodMatch: Record<string, unknown> = { dayStart: { $gte: periodStart(period, now) } }
  if (groupId !== undefined) periodMatch['groupId'] = groupId

  const rows = await collections.listenStats
    .aggregate<{ ahead: number }>([
      { $match: periodMatch },
      {
        $group: {
          _id: '$userId',
          count: { $sum: '$tracksCount' },
          seconds: { $sum: '$secondsCount' },
        },
      },
      {
        $match: {
          $or: [
            { count: { $gt: myCount } },
            { count: myCount, seconds: { $gt: mySeconds } },
            { count: myCount, seconds: mySeconds, _id: { $lt: userId } },
          ],
        },
      },
      { $count: 'ahead' },
    ])
    .toArray()
  return (rows[0]?.ahead ?? 0) + 1
}

export async function globalAllTimeRank(userId: number, totalTracks?: number): Promise<number> {
  const myDoc = await collections.users.findOne(
    { _id: String(userId) },
    { projection: { totalTracksListened: 1, totalSecondsListened: 1 } },
  )
  const myTracks = totalTracks ?? myDoc?.totalTracksListened ?? 0
  const mySeconds = myDoc?.totalSecondsListened ?? 0
  if (myTracks <= 0 && mySeconds <= 0) return 0

  const ahead = await collections.users.countDocuments({
    $or: [
      { totalTracksListened: { $gt: myTracks } },
      { totalTracksListened: myTracks, totalSecondsListened: { $gt: mySeconds } },
      { totalTracksListened: myTracks, totalSecondsListened: mySeconds, _id: { $lt: String(userId) } },
    ],
  })
  return ahead + 1
}

export async function globalRankedCount(): Promise<number> {
  return collections.users.countDocuments({
    $or: [{ totalTracksListened: { $gt: 0 } }, { totalSecondsListened: { $gt: 0 } }],
  })
}

export async function groupRankedCount(groupId: number): Promise<number> {
  return collections.memberListenStats.countDocuments({
    groupId,
    $or: [{ tracksCount: { $gt: 0 } }, { secondsCount: { $gt: 0 } }],
  })
}

export async function groupAllTimeCount(groupId: number, userId: number): Promise<number> {
  const doc = await collections.memberListenStats.findOne(
    { _id: `${groupId}:${userId}` },
    { projection: { tracksCount: 1 } },
  )
  return doc?.tracksCount ?? 0
}

export async function groupAllTimeRank(groupId: number, userId: number, mine?: number): Promise<number> {
  const myDoc = await collections.memberListenStats.findOne(
    { _id: `${groupId}:${userId}` },
    { projection: { tracksCount: 1, secondsCount: 1 } },
  )
  const myTracks = mine ?? myDoc?.tracksCount ?? 0
  const mySeconds = myDoc?.secondsCount ?? 0
  if (myTracks <= 0 && mySeconds <= 0) return 0

  const ahead = await collections.memberListenStats.countDocuments({
    groupId,
    $or: [
      { tracksCount: { $gt: myTracks } },
      { tracksCount: myTracks, secondsCount: { $gt: mySeconds } },
      { tracksCount: myTracks, secondsCount: mySeconds, userId: { $lt: userId } },
    ],
  })
  return ahead + 1
}

export async function groupFirstSeen(groupId: number, userId: number): Promise<Date | null> {
  const doc = await collections.memberListenStats.findOne(
    { _id: `${groupId}:${userId}` },
    { projection: { firstListenedAt: 1 } },
  )
  return doc?.firstListenedAt ?? null
}

export type RankingResetStats = {
  buckets: number
  members: number
  users: number
}

export async function resetAllRanking(): Promise<RankingResetStats> {
  const [delListen, delMemListen, delOldMsg, delOldMem, upd] = await Promise.all([
    collections.listenStats.deleteMany({}),
    collections.memberListenStats.deleteMany({}),
    collections.messageStats.deleteMany({}),
    collections.memberStats.deleteMany({}),
    collections.users.updateMany(
      {
        $or: [
          { totalTracksListened: { $exists: true } },
          { totalSecondsListened: { $exists: true } },
          { totalMessages: { $exists: true } },
          { level: { $exists: true } },
        ],
      },
      {
        $unset: {
          totalTracksListened: '',
          totalSecondsListened: '',
          totalMessages: '',
          level: '',
        },
      },
    ),
  ])
  return {
    buckets: (delListen.deletedCount ?? 0) + (delOldMsg.deletedCount ?? 0),
    members: (delMemListen.deletedCount ?? 0) + (delOldMem.deletedCount ?? 0),
    users: upd.modifiedCount ?? 0,
  }
}

