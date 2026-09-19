/**
 * How a room looks and which player it opens in.
 *
 * Both are the room's own settings, not the viewer's: everyone who joins the
 * same room lands in the same place wearing the same paint, because the room is
 * a shared space and two people describing it differently is the kind of
 * disagreement nobody can settle from inside it. They are set from the bot, by
 * somebody who can run the video chat, and stored beside the room's access
 * policy - see the bot's `roomSettings`.
 *
 * This module is the vocabulary both sides agree on. It holds no colours: the
 * 3D palettes live with the scene that paints them and the 2D tokens live in
 * the stylesheet, and both are keyed by the ids here.
 */
export type RoomMode = "2d" | "3d";

export type RoomStyleId = "default" | "sushi" | "poolrooms" | "halloween";

export type RoomStyle = {
  id: RoomStyleId;
  /** What the bot calls it in the picker. */
  label: string;
  /** One line, for the picker's message. */
  blurb: string;
};

export const ROOM_STYLES: readonly RoomStyle[] = [
  {
    id: "default",
    label: "Midnight",
    blurb: "The one it comes with. Deep blues, warm lamps and dark wood.",
  },
  {
    id: "poolrooms",
    label: "Poolrooms",
    blurb: "White ceramic tile in every direction, ankle-deep and blue-green.",
  },
  {
    id: "halloween",
    label: "Halloween",
    blurb: "A shuttered parlour lit by candles that will not sit still.",
  },
  {
    id: "sushi",
    label: "Sushi",
    blurb: "Near-white walls with a blush of pink, pale seamless boards, soft rose lamps.",
  },
];

export const DEFAULT_STYLE: RoomStyleId = "default";
/*
  Rooms open in the lounge unless somebody says otherwise.

  This is what a room that has never been configured gets, which is most of
  them, so it is also the decision about what the product *is* by default. `/2d`
  opts a room out and the setting sticks from then on.
*/
export const DEFAULT_MODE: RoomMode = "3d";

export function isRoomStyleId(value: unknown): value is RoomStyleId {
  return ROOM_STYLES.some((style) => style.id === value);
}

export function normalizeStyle(value: unknown): RoomStyleId {
  return isRoomStyleId(value) ? value : DEFAULT_STYLE;
}

export function normalizeMode(value: unknown): RoomMode {
  return value === "2d" || value === "3d" ? value : DEFAULT_MODE;
}

export function styleById(id: RoomStyleId): RoomStyle {
  return ROOM_STYLES.find((style) => style.id === id) ?? ROOM_STYLES[0]!;
}

/** Where a room in this mode is played. */
export function roomPath(mode: RoomMode): string {
  return mode === "2d" ? "/room/player" : "/room/3d";
}
