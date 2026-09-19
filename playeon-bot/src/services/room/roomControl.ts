import type { RoomTokenPayload } from './roomToken.js'
export function canControlRoom(payload: RoomTokenPayload): boolean {
  if (payload.user.role === 'superuser' || payload.user.role === 'developer') return true
  return payload.canControl === true
}
