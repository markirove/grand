/**
 * How a reaction button looks, wherever one is offered.
 *
 * Shared rather than written twice, because there are now two places to press
 * one - the tray that opens off the HUD, and the composer row in the chat
 * sheet's Reactions tab - and two copies of a look is two looks the moment
 * either is touched. Only the appearance lives here: the tray's staggered
 * entrance and the sheet's spacing belong to those layouts, not to the button.
 *
 * Glass rather than a themed surface, in both. The tray floats over the room,
 * and the sheet's row sits under a list of reactions people have already sent -
 * an emoji on a translucent disc is the same object in both places, which is
 * the point of pressing it.
 *
 * The size is the caller's, and deliberately not here. The tray's is one of the
 * measurements its fly-out geometry is laid out from, and the sheet's has to
 * match the row it shares with the text composer - two sizes answering to two
 * different neighbours, which is the one thing about the button that cannot be
 * shared.
 *
 * `touch-action` is the caller's for the same reason. The tray sits over the
 * room and must not let a touch that starts on it reach the camera; the sheet's
 * row scrolls sideways, and a button that swallows the pan there leaves only
 * the few pixels of padding between the discs able to move the strip.
 */
export const REACTION_BUTTON =
  "grid shrink-0 place-items-center rounded-full bg-white/12 text-[20px] backdrop-blur-md active:bg-white/25";
