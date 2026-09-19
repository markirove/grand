import { customEmoji } from '../lib/emoji.js'
import { md } from '@mtcute/markdown-parser'
import { filters } from '@mtcute/dispatcher'
import type { Chat, User } from '@mtcute/node'
import { dp, tg } from '../client.js'
import { collections } from '../services/mongo.js'
import { config } from '../config.js'
import { groupIntroText, groupIntroKeyboard } from '../lib/startCard.js'
import { memberCountOf } from '../lib/chatInfo.js'
import { isMediaForbidden } from '../lib/tgErrors.js'

export async function sendGroupIntro(
  chatId: number,
  chatTitle: string,
  actor?: { firstName?: string | null; id?: number } | null,
): Promise<void> {
  const text = groupIntroText(chatTitle, actor)
  const replyMarkup = groupIntroKeyboard(String(chatId))

  const sendPlain = () =>
    tg.sendText(chatId, text, {
      replyMarkup,
      disableWebPreview: true,
    }).catch(() => {})

  // Do not attempt photo if chat permissions forbid photos
  let canSendPhotos = true
  try {
    const fullChat = await tg.getChat(chatId)
    if (fullChat.permissions?.canSendPhotos === false) {
      canSendPhotos = false
    }
  } catch {
  }

  if (!canSendPhotos) {
    await sendPlain()
    return
  }

  const cached = await dp.deps.cache.get<string>('settings:banner').catch(() => null)
  let bannerId = cached
  if (!bannerId) {
    const doc = await collections.settings.findOne({ _id: 'global' }).catch(() => null)
    bannerId = doc?.bannerFileId ?? null
    if (bannerId) await dp.deps.cache.set('settings:banner', bannerId, 3600).catch(() => {})
  }

  if (!bannerId) {
    await sendPlain()
    return
  }

  try {
    await tg.sendMedia(chatId, {
      type: 'photo',
      file: bannerId,
      caption: text,
    }, { replyMarkup })
  } catch (err) {
    if (!isMediaForbidden(err)) throw err
    await sendPlain()
  }
}

export function registerChatJoinHandler() {
  dp.onChatMemberUpdate(
    filters.chatMemberSelf,
    async (upd) => {
      const wasMember = upd.oldMember?.isMember ?? false
      const isMember = upd.newMember?.isMember ?? false

      if (isMember && !wasMember) {
        await handleJoined(upd.chat, upd.isSelfMade ? undefined : upd.actor)
      } else if (wasMember && !isMember) {
        dp.deps.logger.botLeftChat(upd.chat)
      }
    },
  )
}

async function handleJoined(chat: Chat, actor: User | undefined) {
  const chatId = String(chat.id)
  const chatType = chat.chatType as 'group' | 'supergroup' | 'channel'

  if (chatType === 'channel') {
    if (await isCacheOrSystemChannel(chat)) {
      return
    }
    await tg.sendText(
      chat.id,
      md`${customEmoji('👋', '5985478698722136468')} Thanks for adding me! I don't have any **channel** features yet - they might come soon. Leaving for now.`,
    ).catch(() => {})
    await tg.leaveChat(chat.id).catch(() => {})
    return
  }

  await collections.chats.updateOne(
    { _id: chatId },
    {
      $setOnInsert: { prefix: config.defaultPrefix, addedAt: new Date() },
      $set: { title: chat.title, type: chatType },
    },
    { upsert: true },
  )

  const memberCount = await memberCountOf(chat.id)
  dp.deps.logger.botJoinedChat(chat, actor, memberCount)

  await sendGroupIntro(chat.id, chat.title, actor)
}

async function isCacheOrSystemChannel(chat: Chat): Promise<boolean> {
  if (config.logGroupId && chat.id === config.logGroupId) {
    return true
  }

  if (!config.media.cacheChannel) return false
  const target = config.media.cacheChannel.trim()
  const targetClean = target.replace(/^@/, '').toLowerCase()

  if (chat.username && chat.username.toLowerCase() === targetClean) {
    return true
  }
  if (String(chat.id) === target || String(chat.id) === `-100${target}`) {
    return true
  }

  try {
    const peer = await tg.resolvePeer(target)
    if ('channelId' in peer && (peer.channelId === -chat.id || String(chat.id) === `-100${peer.channelId}`)) {
      return true
    }
  } catch {
    // ignore
  }

  return false
}

