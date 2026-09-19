
const A = 1
const B = 2

export function xpForLevel(level: number): number {
  if (level <= 0) return 0
  return A * level * level + B * level
}

export function levelFromXp(xp: number): number {
  if (xp < xpForLevel(1)) return 0
  const level = Math.floor((-B + Math.sqrt(B * B + 4 * A * xp)) / (2 * A))
  return Math.max(0, level)
}

export type LevelProgress = {
  level: number
  current: number
  needed: number
  ratio: number
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp)
  const floor = xpForLevel(level)
  const ceil = xpForLevel(level + 1)
  const needed = ceil - floor
  const current = xp - floor
  return { level, current, needed, ratio: needed > 0 ? current / needed : 0 }
}

export function progressBar(ratio: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}
