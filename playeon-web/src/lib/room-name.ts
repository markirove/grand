/**
 * What to call a room on screen.
 *
 * The bot titles a personal room after its owner - "Sushi's Room" - which is
 * the right phrasing for everyone except the one person it belongs to. A
 * personal room is keyed by its owner's own Telegram id, so the viewer is
 * standing in their own room exactly when the room id and their user id match,
 * and that is the case this exists to catch.
 *
 * A name the owner set themselves always wins. It was chosen deliberately, and
 * overwriting it with "Your Room" would be a worse misreading than the
 * third-person title this fixes.
 */
export function roomDisplayName(input: {
  /** Owner-set name, null when the room uses the bot's default title. */
  roomName: string | null | undefined;
  title: string | null | undefined;
  groupId: string | null | undefined;
  /** The viewer. Null before the session resolves. */
  viewerId: string | null | undefined;
}): string {
  if (input.roomName) return input.roomName;
  if (input.groupId && input.viewerId && input.groupId === input.viewerId) {
    return "Your Room";
  }
  return input.title || "Room";
}
