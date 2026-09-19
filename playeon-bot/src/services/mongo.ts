import { MongoClient, type Collection } from 'mongodb'
import { config } from '../config.js'
import type { UserDoc } from '../models/user.js'
import type { ChatDoc } from '../models/chat.js'
import type { SuperuserDoc } from '../models/superuser.js'
import type { SettingsDoc } from '../models/settings.js'
import type { PlaybackDoc } from '../models/playback.js'
import type { MessageStatDoc } from '../models/messageStat.js'
import type { MemberStatDoc } from '../models/memberStat.js'
import type { ListenStatDoc } from '../models/listenStat.js'
import type { MemberListenStatDoc } from '../models/memberListenStat.js'
import type { RoomAccessDoc } from '../models/roomAccess.js'
import type { GroupAuthDoc } from '../models/groupAuth.js'
import type { PlayEventDoc } from '../models/playEvent.js'
import type { UserMemoryDoc } from '../models/userMemory.js'

export type Collections = {
  users: Collection<UserDoc>
  chats: Collection<ChatDoc>
  superusers: Collection<SuperuserDoc>
  settings: Collection<SettingsDoc>
  playbacks: Collection<PlaybackDoc>
  messageStats: Collection<MessageStatDoc>
  memberStats: Collection<MemberStatDoc>
  listenStats: Collection<ListenStatDoc>
  memberListenStats: Collection<MemberListenStatDoc>
  roomAccess: Collection<RoomAccessDoc>
  groupAuth: Collection<GroupAuthDoc>
  playEvents: Collection<PlayEventDoc>
  userMemories: Collection<UserMemoryDoc>
}

let _client: MongoClient | undefined
export const collections = {} as Collections

export async function initMongo() {
  _client = new MongoClient(config.mongoUri, { maxPoolSize: 20, minPoolSize: 2 })
  await _client.connect()
  const db = _client.db(config.mongoDb)
  collections.users = db.collection('users')
  collections.chats = db.collection('chats')
  collections.superusers = db.collection('superusers')
  collections.settings = db.collection('settings')
  collections.playbacks = db.collection('playbacks')
  collections.messageStats = db.collection('message_stats')
  collections.memberStats = db.collection('member_stats')
  collections.listenStats = db.collection('listen_stats')
  collections.memberListenStats = db.collection('member_listen_stats')
  collections.roomAccess = db.collection('room_access')
  collections.groupAuth = db.collection('group_auth')
  collections.playEvents = db.collection('play_events')
  collections.userMemories = db.collection('ai_user_memories')
  await Promise.all([
    collections.chats.createIndex({ prefix: 1 }),
    collections.superusers.createIndex({ addedAt: -1 }),
    collections.playbacks.createIndex({ sourceId: 1 }),
    collections.playbacks.createIndex({ lastUsedAt: -1 }),
    collections.listenStats.createIndex({ groupId: 1, dayStart: 1 }),
    collections.listenStats.createIndex({ groupId: 1, userId: 1, dayStart: 1 }),
    collections.listenStats.createIndex({ userId: 1, dayStart: 1 }),
    collections.listenStats.createIndex({ dayStart: 1 }, { expireAfterSeconds: 60 * 86400 }),
    collections.memberListenStats.createIndex({ groupId: 1, tracksCount: -1 }),
    collections.users.createIndex({ totalTracksListened: -1 }),
    collections.groupAuth.createIndex({ groupId: 1, createdAt: -1 }),
    collections.playEvents.createIndex({ at: -1 }),
  ])
  console.log('[mongo] connected')
}

export async function closeMongo() {
  await _client?.close()
}
