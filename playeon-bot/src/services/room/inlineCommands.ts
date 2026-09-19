export type InlineCommandAction = 'pause' | 'resume' | 'skip' | 'end' | 'queue' | 'loop'

export const INLINE_COMMANDS: { name: InlineCommandAction; title: string; description: string }[] = [
  { name: 'pause', title: 'Pause', description: 'Pause playback in your room' },
  { name: 'resume', title: 'Resume', description: 'Resume playback in your room' },
  { name: 'skip', title: 'Skip', description: 'Skip to the next track' },
  { name: 'end', title: 'End', description: 'Stop playback and clear the queue' },
  { name: 'queue', title: 'Queue', description: 'Show what’s playing and up next' },
  { name: 'loop', title: 'Loop', description: 'Repeat the current track (e.g. /loop 3, /loop off)' },
]
