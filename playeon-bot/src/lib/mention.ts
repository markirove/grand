import { md } from '@mtcute/markdown-parser'
import type { Fragment } from './md.js'

export function isDummyUserId(userId: number | string | null | undefined): boolean {
  if (userId == null || userId === '') return true
  const s = String(userId)
  return s === '999999999' || s === '0' || s.startsWith('dev_') || s.startsWith('test_')
}

export function mention(name: string, userId: number | string | null | undefined): Fragment {
  if (isDummyUserId(userId)) return md`**${name}**`
  return md`[${name}](tg://user?id=${userId})`
}

export function mentionOr(name: string, userId?: number | string | null): Fragment {
  return userId != null && userId !== '' && !isDummyUserId(userId)
    ? mention(name, userId)
    : md`**${name}**`
}

