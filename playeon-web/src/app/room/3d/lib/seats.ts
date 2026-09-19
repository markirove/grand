import { COUCH, PLAYER } from "./tuning";

export type Seat = {
  x: number;
  z: number;
  y: number;
  yaw: number;
  eyeY: number;
  exitX: number;
  exitZ: number;
};

export function cushionX(index: number): number {
  const usable = COUCH.width - COUCH.armWidth * 2;
  const pitch = usable / COUCH.seats;
  return COUCH.x - usable / 2 + pitch * (index + 0.5);
}

const COUCH_SEAT_Z = COUCH.z - COUCH.backDepth / 2;
const COUCH_EXIT_Z = COUCH.z - COUCH.depth / 2 - PLAYER.radius - 0.3;

export const SEATS: readonly Seat[] = Array.from(
  { length: COUCH.seats },
  (_, index) => ({
    x: cushionX(index),
    y: COUCH.seatY,
    z: COUCH_SEAT_Z,
    yaw: 0,
    eyeY: COUCH.sitEyeY,
    exitX: cushionX(index),
    exitZ: COUCH_EXIT_Z,
  }),
);

export function seatAt(index: number): Seat | null {
  return SEATS[index] ?? null;
}

export function cushionAtX(x: number): number {
  const usable = COUCH.width - COUCH.armWidth * 2;
  const pitch = usable / COUCH.seats;
  const along = Math.floor((x - (COUCH.x - usable / 2)) / pitch);
  return Math.min(COUCH.seats - 1, Math.max(0, along));
}
