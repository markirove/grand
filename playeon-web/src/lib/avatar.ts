// hand-picked hues: indigo, rose, emerald, azure, amber, teal - no violet
export const AVATAR_HUES = [268, 22, 152, 232, 72, 192];

export function initial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

/** Stable per-person hue, so someone keeps the same colour across renders. */
export function avatarHue(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length]!;
}
