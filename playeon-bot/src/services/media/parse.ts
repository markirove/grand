
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase()
  if (!raw) return null
  if (raw.includes(':')) {
    if (!/^\d+:\d{1,2}(:\d{1,2})?$/.test(raw)) return null
    return raw.split(':').reduce((acc, p) => acc * 60 + Number(p), 0)
  }
  const m = raw.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s?)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return (m[1] ? Number(m[1]) * 3600 : 0) + (m[2] ? Number(m[2]) * 60 : 0) + (m[3] ? Number(m[3]) : 0)
}

export function parseLoopCount(raw: string): number | null {
  const t = raw.trim().toLowerCase()
  if (!t || t === 'off' || t === 'stop' || t === 'no') return 0
  if (!/^\d+$/.test(t)) return null
  return Math.min(Number(t), 100)
}

export async function probeMediaDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    const sec = parseFloat(stdout.trim())
    return isFinite(sec) && sec > 0 ? Math.round(sec) : null
  } catch {
    return null
  }
}
