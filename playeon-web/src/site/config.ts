/**
 * Site-wide configuration and feature flags.
 * Flip a flag here rather than deleting UI, so nothing has to be rebuilt later.
 */
export const siteConfig = {
  features: {
    /** Show the "Watching / Listening / Playing" label in the activity bar. */
    activityVerb: false,
    /** Show the scrubber + play/seek deck on the player page. */
    playbackControls: true,
  },
} as const;
