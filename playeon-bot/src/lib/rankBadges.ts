import { customEmoji } from './emoji.js'
import { md } from '@mtcute/markdown-parser'
import type { TextWithEntities } from '@mtcute/core'

export const TROPHY_EMOJI_ID = '6106892046881005402'

export const RANK_BADGES: { glyph: string; id: string }[] = [
  { glyph: '1️⃣', id: '5794182096603847292' },
  { glyph: '2️⃣', id: '5794303034292968945' },
  { glyph: '3️⃣', id: '5794031944547178894' },
  { glyph: '4️⃣', id: '5793901252987330401' },
  { glyph: '5️⃣', id: '5794066823976592976' },
  { glyph: '6️⃣', id: '5794235255414069703' },
  { glyph: '7️⃣', id: '5794030595927448202' },
  { glyph: '8️⃣', id: '5794426162415409242' },
  { glyph: '9️⃣', id: '5793905801357695657' },
  { glyph: '🔟', id: '5794310013614824017' },
]

export function trophy(plain: boolean): TextWithEntities {
  return plain ? md`Leaderboard` : customEmoji('🏆', TROPHY_EMOJI_ID)
}

export function rankBadge(rank: number, plain: boolean): TextWithEntities {
  if (rank <= 0) return md`-`
  const b = RANK_BADGES[rank - 1]
  if (!b) return md`#${String(rank)}`
  return plain ? md`#${String(rank)}` : customEmoji(b.glyph, b.id)
}
