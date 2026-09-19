import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { RawDocument } from '@mtcute/node'
import type { CommandContext } from '../../core/command.js'
import { config } from '../../config.js'
import { runMtprotoTransfer } from './mtprotoGate.js'

export type TempMedia = { path: string; dispose: () => Promise<void> }

export async function downloadMediaToTemp(
  tg: CommandContext['tg'],
  media: RawDocument,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<TempMedia> {
  await mkdir(config.media.tmpDir, { recursive: true })
  const rawExt = media.fileName?.split('.').pop() ?? ''
  const ext = /^[a-z0-9]{1,5}$/i.test(rawExt) ? rawExt.toLowerCase() : 'bin'
  const filePath = path.join(config.media.tmpDir, `${randomBytes(8).toString('hex')}.${ext}`)

  try {
    await runMtprotoTransfer(() =>
      tg.downloadToFile(filePath, media, onProgress ? { progressCallback: onProgress } : undefined),
    )
  } catch (err) {
    await rm(filePath, { force: true }).catch(() => {})
    throw err
  }

  return { path: filePath, dispose: () => rm(filePath, { force: true }).then(() => {}) }
}
