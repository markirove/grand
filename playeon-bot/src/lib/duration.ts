const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
}

export function parseShortDuration(input: string): number | null {
  const m = input.match(/^(\d+)([smhdw])$/i)
  if (!m || !m[1] || !m[2]) return null
  const unit = UNIT_SECONDS[m[2].toLowerCase()]
  if (unit === undefined) return null
  return parseInt(m[1], 10) * unit
}
