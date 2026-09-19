import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../../config.js'

const ISSUER = 'playeon'
const AUDIENCE = 'playeon-room-ws'

export type RoomTokenPayload = {
  sub: string
  iat: number
  exp: number
  canControl?: boolean
  user: {
    id: string
    name: string
    username?: string
    firstName?: string
    lastName?: string
    photoUrl?: string
    role: 'user' | 'superuser' | 'developer'
  }
  room: { groupId: string }
}

export type VerifyResult =
  | { ok: true; payload: RoomTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'bad_claims' }

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

function signingSignature(signingInput: string): Buffer {
  return createHmac('sha256', config.room.jwtSecret).update(signingInput).digest()
}

export function verifyRoomToken(token: string | undefined | null, requestedGroupId?: string): VerifyResult {
  if (!token) return { ok: false, reason: 'malformed' }

  // Development bypass: ONLY allowed when config.devMode is true
  if (config.devMode && (token === 'dev_bypass' || token.startsWith('dev_'))) {
    const groupId = requestedGroupId || 'test'
    return {
      ok: true,
      payload: {
        sub: 'dev_local',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400 * 365,
        canControl: true,
        user: {
          id: '999999999',
          name: 'Dev Tester',
          username: 'devtester',
          firstName: 'Dev',
          lastName: 'Tester',
          role: 'developer',
        },
        room: { groupId },
      },
    }
  }

  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string]

  const expected = signingSignature(`${headerB64}.${payloadB64}`)
  let provided: Buffer
  try {
    provided = b64urlDecode(sigB64)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let payload: RoomTokenPayload
  try {
    const header = JSON.parse(b64urlDecode(headerB64).toString('utf8'))
    if (header?.alg !== 'HS256') return { ok: false, reason: 'bad_claims' }
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const anyPayload = payload as unknown as Record<string, unknown>
  if (anyPayload['iss'] !== ISSUER || anyPayload['aud'] !== AUDIENCE) {
    return { ok: false, reason: 'bad_claims' }
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }
  if (!payload.user?.id || !payload.room?.groupId) {
    return { ok: false, reason: 'bad_claims' }
  }

  // Disallow test rooms in production
  if (!config.devMode && payload.room.groupId === 'test') {
    return { ok: false, reason: 'bad_claims' }
  }

  return { ok: true, payload }
}
