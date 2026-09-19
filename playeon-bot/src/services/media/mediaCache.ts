import { InputMedia, type InputPeerLike } from '@mtcute/node'
import { config } from '../../config.js'
import type { CommandContext } from '../../core/command.js'
import type { Collections } from '../mongo.js'
import type { PlaybackDoc } from '../../models/playback.js'
import { downloadMediaToTemp, type TempMedia } from './download.js'
import { runMtprotoTransfer } from './mtprotoGate.js'
import type { ResolvedTrack } from './musicSource.js'

type Tg = CommandContext['tg']

export class MediaCacheError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaCacheError'
  }
}

const cacheKey = (sourceId: string, video: boolean, variant?: string): string =>
  `${sourceId}:${video ? 'v' : 'a'}${variant ? `:${variant}` : ''}`

class MediaCacheImpl {
  private channel: InputPeerLike | null = null

  get enabled(): boolean {
    return !!config.media.cacheChannel
  }

  async lookup(db: Collections, sourceId: string, video: boolean, variant?: string): Promise<PlaybackDoc | null> {
    if (!this.enabled) return null
    return db.playbacks.findOne({ _id: cacheKey(sourceId, video, variant) })
  }

  async fetch(tg: Tg, db: Collections, doc: PlaybackDoc, onProgress?: (d: number, t: number) => void): Promise<TempMedia> {
    const channel = await this.resolveChannel(tg)
    const [msg] = await runMtprotoTransfer(() => tg.getMessages(channel, [doc.channelMessageId]))
    const media = msg?.media
    const downloadable =
      media && (media.type === 'document' || media.type === 'audio' || media.type === 'video' || media.type === 'voice')
        ? media
        : null

    if (!downloadable) {
      await db.playbacks.deleteOne({ _id: doc._id }).catch(() => {})
      throw new MediaCacheError('cached file no longer available')
    }

    const temp = await downloadMediaToTemp(tg, downloadable, onProgress)
    await db.playbacks
      .updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() }, $inc: { useCount: 1 } })
      .catch(() => {})
    return temp
  }

  async store(
    tg: Tg,
    db: Collections,
    track: ResolvedTrack,
    video: boolean,
    filePath: string,
    fileName?: string,
    variant?: string,
  ): Promise<void> {
    if (!this.enabled) return

    const key = cacheKey(track.id, video, variant)
    try {
      if (await db.playbacks.findOne({ _id: key })) return

      const channel = await this.resolveChannel(tg)
      const caption = `${track.title}\n${track.url}`
      /*
        `document`, and it has to stay `document`.

        It is the only input type mtcute normalises to `forceFile: true` with
        nothing but a filename attribute, which is what makes Telegram store
        the bytes verbatim. `InputMedia.audio` would attach a
        `documentAttributeAudio` and hand the file to the music player - nicer
        to browse in the channel, and the round trip stops being lossless.
        This is the archive the room plays back from: whatever is uploaded
        here is exactly what every listener gets, so it is worth the duller
        channel.
      */
      const sent = await runMtprotoTransfer(() =>
        tg.sendMedia(channel, InputMedia.document(`file:${filePath}`, { fileName, caption })),
      )

      const doc: PlaybackDoc = {
        _id: key,
        sourceId: track.id,
        sourceUrl: track.url,
        video,
        title: track.title,
        duration: track.duration,
        channelMessageId: sent.id,
        fileName,
        fileSize: 'fileSize' in (sent.media ?? {}) ? (sent.media as { fileSize?: number }).fileSize ?? undefined : undefined,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        useCount: 0,
      }
      await db.playbacks.updateOne({ _id: key }, { $set: doc }, { upsert: true })
    } catch (err) {
      console.error('[mediaCache] store failed:', err instanceof Error ? err.message : err)
    }
  }

  private async resolveChannel(tg: Tg): Promise<InputPeerLike> {
    if (!config.media.cacheChannel) throw new MediaCacheError('no cache channel configured')
    if (!this.channel) {
      this.channel = await tg.resolvePeer(config.media.cacheChannel)
    }
    return this.channel
  }
}

export const mediaCache = new MediaCacheImpl()
