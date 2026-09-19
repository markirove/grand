/**
 * Clock formatting for track positions and lengths.
 *
 * Hours are shown only once there are any: a three-minute song reads `3:07`,
 * not `0:03:07`. Rooms do play hour-long streams, though - sets, podcasts,
 * streams - and a bare minute count runs away from the reader at that length
 * (`93:20` is a number to work out, `1:33:20` is a time). Minutes and seconds
 * are zero-padded once a larger unit sits to their left, and never before it.
 */
export function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(mins)}:${pad(secs)}`
    : `${mins}:${pad(secs)}`;
}
