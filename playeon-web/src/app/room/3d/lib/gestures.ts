import { GESTURE } from "./tuning";

import { ROOM_GESTURES, type RoomGestureKind } from "@/lib/room-protocol";

export type GestureRole = "actor" | "target";

export type Cooldowns = Record<RoomGestureKind, number>;

export function noCooldowns(): Cooldowns {
  return Object.fromEntries(
    ROOM_GESTURES.map((kind) => [kind, 0]),
  ) as Cooldowns;
}

export function cooldownMs(kind: RoomGestureKind): number {
  return GESTURE[kind].cooldownSec * 1000;
}

export type GestureFrame = {
  armX: [number, number];
  armZ: [number, number];
  legX: [number, number];
  lean: number;
  yaw: number;
};

export function emptyGestureFrame(): GestureFrame {
  return { armX: [0, 0], armZ: [0, 0], legX: [0, 0], lean: 0, yaw: 0 };
}

export function clearGestureFrame(frame: GestureFrame): void {
  frame.armX[0] = frame.armX[1] = 0;
  frame.armZ[0] = frame.armZ[1] = 0;
  frame.legX[0] = frame.legX[1] = 0;
  frame.lean = 0;
  frame.yaw = 0;
}

export function gestureSec(kind: RoomGestureKind, role: GestureRole): number {
  if (kind === "slap") {
    return role === "actor" ? GESTURE.slap.sec : GESTURE.slap.recoilSec;
  }
  if (kind === "kick") {
    return role === "actor" ? GESTURE.kick.sec : GESTURE.kick.recoilSec;
  }
  return GESTURE[kind].sec;
}

export function gestureDelay(kind: RoomGestureKind, role: GestureRole): number {
  if (role === "actor") return 0;
  if (kind === "slap") return GESTURE.slap.sec * STRIKE;
  if (kind === "kick") return GESTURE.kick.sec * BOOT;
  return 0;
}

const STRIKE = 0.42;

const BOOT = 0.38;

export type GestureSide = 0 | 1;

/**
 * Where the other party is, in this body's own frame of reference.
 *
 * `bearing` is the yaw delta that would face them, so a reaction can turn
 * towards whoever it is reacting to. `push` is the lateral component of the
 * blow across this body, +1 being a shove towards its right, so a recoil can
 * go the way it was actually hit rather than always the same way.
 */
export type GestureAim = {
  bearing: number;
  push: number;
};

export const NO_AIM: GestureAim = { bearing: 0, push: 0 };

const TURN_LIMIT = 0.5;

function towards(bearing: number): number {
  const turn = bearing * 0.6;
  return turn < -TURN_LIMIT ? -TURN_LIMIT : turn > TURN_LIMIT ? TURN_LIMIT : turn;
}

// A glancing blow still has to move somebody, and a dead-on one has no side to
// fall to, so the shove keeps its direction but never its full smallness.
function shoved(push: number): number {
  if (push === 0) return 1;
  const sign = push < 0 ? -1 : 1;
  const size = Math.abs(push);
  return sign * (size < 0.35 ? 0.35 : size);
}

export function gestureFrame(
  kind: RoomGestureKind,
  role: GestureRole,
  t: number,
  out: GestureFrame,
  aim: GestureAim = NO_AIM,
): void {
  clearGestureFrame(out);
  if (t <= 0 || t >= 1) return;

  const side: GestureSide = aim.bearing <= 0 ? 1 : 0;

  if (kind === "slap") {
    if (role === "actor") slapActor(t, out, side);
    else slapTarget(t, out, aim.push);
    return;
  }
  if (kind === "kick") {
    if (role === "actor") kickActor(t, out, side);
    else kickTarget(t, out, aim.push);
    return;
  }
  if (kind === "kiss") {
    kiss(role, t, out, aim.bearing);
    return;
  }
  hug(role, t, out, aim.bearing);
}

function kickActor(t: number, out: GestureFrame, side: GestureSide): void {
  const { windUp, swing, lean, armCounter } = GESTURE.kick;
  const other: GestureSide = side === 1 ? 0 : 1;
  const mirror = side === 1 ? 1 : -1;

  if (t < BOOT) {
    const k = ease(t / BOOT);
    out.legX[side] = windUp * k;
    out.lean = lean * 0.8 * k;
    out.armX[other] = -armCounter * k;
    out.armX[side] = armCounter * 0.5 * k;
    out.yaw = mirror * 0.06 * k;
    return;
  }

  const after = (t - BOOT) / (1 - BOOT);
  if (after < 0.24) {
    const k = after / 0.24;
    out.legX[side] = windUp + (-swing - windUp) * k;
    out.lean = lean * (0.8 - 1.6 * k);
    out.armX[other] = -armCounter * (1 - k) + armCounter * 0.6 * k;
    out.armX[side] = armCounter * 0.5 * (1 - k);
    out.yaw = mirror * 0.06 * (1 - k);
    return;
  }

  const k = ease((after - 0.24) / 0.76);
  out.legX[side] = -swing * (1 - k);
  out.lean = -lean * 0.8 * (1 - k);
  out.armX[other] = armCounter * 0.6 * (1 - k);
}

function kickTarget(t: number, out: GestureFrame, push: number): void {
  const { recoil } = GESTURE.kick;
  const decay = Math.exp(-2.6 * t);
  const swing = Math.sin(t * Math.PI * 1.2) * decay;
  const shove = shoved(push);

  out.yaw = -shove * recoil * 0.55 * swing;
  out.lean = -recoil * 1.5 * swing;
  out.armX[0] = -recoil * 1.8 * swing;
  out.armX[1] = -recoil * 1.8 * swing;
  out.armZ[0] = recoil * swing;
  out.armZ[1] = -recoil * swing;
  out.legX[0] = recoil * 1.2 * swing;
  out.legX[1] = recoil * 0.7 * swing;
}

function slapActor(t: number, out: GestureFrame, side: GestureSide): void {
  const { lift, across, lean } = GESTURE.slap;
  const mirror = side === 1 ? 1 : -1;

  if (t < STRIKE) {
    const k = ease(t / STRIKE);
    out.armZ[side] = mirror * lift * k;
    out.armX[side] = 0.55 * k;
    out.lean = -lean * 0.35 * k;
    out.yaw = mirror * -0.12 * k;
    return;
  }

  const after = (t - STRIKE) / (1 - STRIKE);
  if (after < 0.28) {
    const k = after / 0.28;
    out.armZ[side] = mirror * (lift + (-across - lift) * k);
    out.armX[side] = 0.55 + 0.5 * k;
    out.lean = lean * k;
    out.yaw = mirror * 0.16 * k;
    return;
  }

  const k = ease((after - 0.28) / 0.72);
  out.armZ[side] = mirror * -across * (1 - k);
  out.armX[side] = 1.05 * (1 - k);
  out.lean = lean * (1 - k);
  out.yaw = mirror * 0.16 * (1 - k);
}

function slapTarget(t: number, out: GestureFrame, push: number): void {
  const { recoil } = GESTURE.slap;
  const decay = Math.exp(-3.4 * t);
  const swing = Math.sin(t * Math.PI * 1.5) * decay;
  const shove = shoved(push);

  out.yaw = -shove * recoil * swing;
  out.lean = -recoil * 0.55 * swing;
  out.armX[0] = -0.35 * swing;
  out.armX[1] = 0.35 * swing;
  out.armZ[0] = shove * 0.3 * swing;
  out.armZ[1] = shove * 0.3 * swing;
}

function kiss(
  role: GestureRole,
  t: number,
  out: GestureFrame,
  bearing: number,
): void {
  const { lean, armBack } = GESTURE.kiss;
  const k = t < 0.33 ? ease(t / 0.33) : t > 0.7 ? ease((1 - t) / 0.3) : 1;
  const scale = role === "actor" ? 1 : 0.45;
  out.lean = lean * k * scale;
  out.armX[0] = -armBack * k * scale;
  out.armX[1] = -armBack * k * scale;
  if (role === "target") out.yaw = towards(bearing) * k;
}

function hug(
  role: GestureRole,
  t: number,
  out: GestureFrame,
  bearing: number,
): void {
  const { forward, squeeze, lean } = GESTURE.hug;
  const k = t < 0.25 ? ease(t / 0.25) : t > 0.72 ? ease((1 - t) / 0.28) : 1;
  const tighten = t > 0.3 && t < 0.72 ? Math.sin((t - 0.3) / 0.42 * Math.PI) : 0;

  out.armX[0] = forward * k;
  out.armX[1] = forward * k;
  out.armZ[0] = (squeeze + 0.25 * tighten) * k;
  out.armZ[1] = -(squeeze + 0.25 * tighten) * k;
  out.lean = lean * k;
  if (role === "target") out.yaw = towards(bearing) * k;
}

function ease(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
