import { seatAt } from "./seats";
import { BOB, BODY, BODY_HEIGHT, COUCH, GESTURE, LOOK, PLAYER, WORLD } from "./tuning";
import type { Frame } from "./input";

export type Blocker = { x: number; y: number; z: number };

const STEERED: Frame = {
  strafe: 0,
  forward: 0,
  lookYaw: 0,
  lookPitch: 0,
  jump: false,
  interact: false,
  stand: false,
  gesture: null,
};


export class Player {
  x = 0;
  y = 0;
  z = 4.2;

  vx = 0;
  vy = 0;
  vz = 0;

  yaw = 0;
  pitch = 0;

  grounded = true;

  seated = false;

  private blockers: Iterable<Blocker> = [];
  seat = -1;

  private bobPhase = 0;
  private bobWeight = 0;
  private lastFall = 0;

  private coyote: number = PLAYER.coyoteSec;
  private buffered: number = 0;

  private blend = 0;
  private walkX = 0;
  private walkZ = 4.2;
  private yawAtSit = 0;
  private pitchAtSit = 0;
  private aligned = false;

  private walkingTo = false;
  private goalX = 0;
  private goalZ = 0;
  private goalGap = 0;
  private goalAge = 0;
  private goalBest = Number.POSITIVE_INFINITY;
  private goalStall = 0;
  private goalReached = false;

  approach(x: number, z: number, gap: number): void {
    this.goalX = x;
    this.goalZ = z;
    this.goalGap = gap;
    if (!this.walkingTo) {
      this.walkingTo = true;
      this.goalAge = 0;
      this.goalBest = Number.POSITIVE_INFINITY;
      this.goalStall = 0;
      this.goalReached = false;
    }
    if (this.seated) this.stand();
  }

  cancelApproach(): void {
    this.walkingTo = false;
    this.goalReached = false;
  }

  launch(awayX: number, awayZ: number): void {
    this.cancelApproach();
    if (this.seated) this.stand();

    const len = Math.hypot(awayX, awayZ);
    const nx = len > 1e-4 ? awayX / len : 0;
    const nz = len > 1e-4 ? awayZ / len : 1;

    this.vx = nx * GESTURE.kick.launchSpeed;
    this.vz = nz * GESTURE.kick.launchSpeed;
    this.vy = GESTURE.kick.launchLift;
    this.grounded = false;
  }

  get arrived(): boolean {
    return this.walkingTo && this.goalReached;
  }

  get gaveUp(): boolean {
    return this.walkingTo && this.goalAge >= GESTURE.approach.timeoutSec;
  }

  sit(seat: number): void {
    if (this.seated) return;
    this.seated = true;
    this.seat = seat;
    this.yawAtSit = this.yaw;
    this.pitchAtSit = this.pitch;
    this.aligned = false;
    this.vx = this.vy = this.vz = 0;
    this.bobWeight = 0;
    const taken = seatAt(seat);
    this.walkX = taken?.exitX ?? this.x;
    this.walkZ = taken?.exitZ ?? this.z;
  }

  stand(): void {
    this.seated = false;
  }

  get settling(): boolean {
    return this.blend > 0 && this.blend < 1;
  }

  step(dt: number, input: Frame, blockers: Iterable<Blocker> = []): void {
    this.blockers = blockers;
    const frame = this.walkingTo ? this.steer(dt) : input;
    const target = this.seated ? 1 : 0;
    const rate = dt / PLAYER.sitBlendSec;
    this.blend =
      target > this.blend
        ? Math.min(target, this.blend + rate)
        : Math.max(target, this.blend - rate);

    if (!this.settling) {
      this.yaw += frame.lookYaw;
      this.pitch = clamp(
        this.pitch + frame.lookPitch,
        -LOOK.maxPitch,
        LOOK.maxPitch,
      );
    }
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    if (this.blend > 0) {
      this.settle();
      return;
    }
    this.seat = -1;

    this.walk(dt, frame);
    this.walkX = this.x;
    this.walkZ = this.z;
  }

  private steer(dt: number): Frame {
    this.goalAge += dt;

    const dx = this.goalX - this.x;
    const dz = this.goalZ - this.z;
    const gap = Math.hypot(dx, dz);

    const want = Math.atan2(-dx, -dz);
    const off = shortestDelta(this.yaw, want);
    const swing = GESTURE.approach.turn * dt;
    this.yaw += Math.abs(off) <= swing ? off : Math.sign(off) * swing;
    this.pitch += (0 - this.pitch) * Math.min(1, GESTURE.approach.turn * dt);

    if (this.blend > 0) {
      this.goalStall = 0;
    } else if (gap < this.goalBest - GESTURE.approach.progressM) {
      this.goalBest = gap;
      this.goalStall = 0;
    } else {
      this.goalStall += dt;
    }

    const short = gap <= this.goalGap;
    const wedged = this.goalStall >= GESTURE.approach.stallSec;
    this.goalReached =
      (short || wedged) && Math.abs(off) <= GESTURE.approach.aim;

    STEERED.forward =
      short || wedged ? 0 : GESTURE.approach.speed / PLAYER.walkSpeed;
    return STEERED;
  }

  private settle(): void {
    const t = ease(this.blend);

    const seat = seatAt(this.seat);
    if (!seat) return;

    this.x = lerp(this.walkX, seat.x, t);
    this.z = lerp(this.walkZ, seat.z, t);
    this.y = lerp(0, seat.y, t);

    if (!this.seated) return;

    if (this.blend < 1) {
      this.yaw = shortestAngle(this.yawAtSit, seat.yaw, t);
      this.pitch = lerp(this.pitchAtSit, 0, t);
      return;
    }
    if (!this.aligned) {
      this.aligned = true;
      this.yaw = seat.yaw;
      this.pitch = 0;
    }
  }

  private walk(dt: number, frame: Frame): void {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = cos * frame.strafe - sin * frame.forward;
    const wishZ = -sin * frame.strafe - cos * frame.forward;
    const wishMag = Math.min(1, Math.hypot(wishX, wishZ));

    const control = this.grounded ? 1 : PLAYER.airControl;

    if (wishMag > 0) {
      const dx = wishX * PLAYER.walkSpeed - this.vx;
      const dz = wishZ * PLAYER.walkSpeed - this.vz;
      const diff = Math.hypot(dx, dz);
      const push = Math.min(diff, PLAYER.accel * control * dt);
      if (diff > 0) {
        this.vx += (dx / diff) * push;
        this.vz += (dz / diff) * push;
      }
    } else if (this.grounded) {
      const speed = Math.hypot(this.vx, this.vz);
      const drop = Math.min(speed, PLAYER.friction * dt);
      if (speed > 0) {
        this.vx -= (this.vx / speed) * drop;
        this.vz -= (this.vz / speed) * drop;
      }
    }

    this.coyote = this.grounded
      ? PLAYER.coyoteSec
      : Math.max(0, this.coyote - dt);
    this.buffered = frame.jump
      ? PLAYER.jumpBufferSec
      : Math.max(0, this.buffered - dt);
    if (this.buffered > 0 && this.coyote > 0) {
      this.vy = PLAYER.jumpSpeed;
      this.grounded = false;
      this.buffered = 0;
      this.coyote = 0;
    }

    this.vy -= PLAYER.gravity * dt;

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    this.collide();
    this.updateBob(dt);
  }

  private collide(): void {
    this.avoidBodies();

    const limitX = WORLD.halfX - PLAYER.radius;
    const limitZ = WORLD.halfZ - PLAYER.radius;

    if (this.x > limitX) {
      this.x = limitX;
      if (this.vx > 0) this.vx = 0;
    } else if (this.x < -limitX) {
      this.x = -limitX;
      if (this.vx < 0) this.vx = 0;
    }

    if (this.z > limitZ) {
      this.z = limitZ;
      if (this.vz > 0) this.vz = 0;
    } else if (this.z < -limitZ) {
      this.z = -limitZ;
      if (this.vz < 0) this.vz = 0;
    }

    const headroom = WORLD.height - PLAYER.height;
    if (this.y >= headroom) {
      this.y = headroom;
      if (this.vy > 0) this.vy = 0;
    }

    const onCouch = this.couchCollide();

    const floor = onCouch ? COUCH.backY : 0;
    if (this.y <= floor) {
      this.y = floor;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  private avoidBodies(): void {
    for (const other of this.blockers) {
      if (this.y >= other.y + BODY_HEIGHT) continue;
      if (this.y + PLAYER.height <= other.y) continue;
      this.pushOutOf(other.x, other.z, BODY.radius);
    }
  }

  private pushOutOf(x: number, z: number, radius: number): void {
    const reach = PLAYER.radius + radius;

    let dx = this.x - x;
    let dz = this.z - z;
    let distance = Math.hypot(dx, dz);
    if (distance >= reach) return;

    if (distance < 1e-4) {
      dx = 0;
      dz = 1;
      distance = 1;
    }

    const nx = dx / distance;
    const nz = dz / distance;
    this.x += nx * (reach - distance);
    this.z += nz * (reach - distance);

    const into = this.vx * nx + this.vz * nz;
    if (into < 0) {
      this.vx -= nx * into;
      this.vz -= nz * into;
    }
  }

  private couchCollide(): boolean {
    const halfW = COUCH.width / 2 + PLAYER.radius;
    const halfD = COUCH.depth / 2 + PLAYER.radius;
    const dx = this.x - COUCH.x;
    const dz = this.z - COUCH.z;

    const insideX = Math.abs(dx) < halfW;
    const insideZ = Math.abs(dz) < halfD;
    if (!insideX || !insideZ) return false;

    if (this.y >= COUCH.backY) return true;

    if (this.vy < 0 && this.y > COUCH.backY - 0.35) {
      this.y = COUCH.backY;
      return true;
    }

    const outX = halfW - Math.abs(dx);
    const outZ = halfD - Math.abs(dz);
    if (outX < outZ) {
      this.x = COUCH.x + Math.sign(dx || 1) * halfW;
      this.vx = 0;
    } else {
      this.z = COUCH.z + Math.sign(dz || 1) * halfD;
      this.vz = 0;
    }
    return false;
  }

  private updateBob(dt: number): void {
    const speed = Math.hypot(this.vx, this.vz);
    const moving = this.grounded && speed > 0.1;
    this.bobPhase += speed * dt * BOB.perMetre;

    const target = moving ? Math.min(1, speed / PLAYER.walkSpeed) : 0;
    const blend = Math.min(1, BOB.settle * dt);
    this.bobWeight += (target - this.bobWeight) * blend;
  }

  /**
   * True once, on the frame a foot lands. False every other time it is asked.
   *
   * Read off the head bob rather than kept as its own timer, because the bob
   * *is* the walk cycle: it only advances while moving, its rate already scales
   * with speed, and a footfall is half a cycle of it. Anything else would be a
   * second clock to keep in step with the first.
   */
  takeStep(): boolean {
    const fall = Math.floor(this.bobPhase / Math.PI);
    if (fall === this.lastFall) return false;
    this.lastFall = fall;
    return this.grounded && this.bobWeight > 0.25;
  }

  /** How hard that step landed, 0-1. */
  get pace(): number {
    return Math.min(1, Math.hypot(this.vx, this.vz) / PLAYER.walkSpeed);
  }

  eyeY(): number {
    const standing =
      this.y +
      PLAYER.eyeHeight +
      Math.sin(this.bobPhase) * BOB.amplitude * this.bobWeight;
    if (this.blend === 0) return standing;
    return lerp(
      standing,
      this.y + (seatAt(this.seat)?.eyeY ?? COUCH.sitEyeY),
      ease(this.blend),
    );
  }

  eyeSway(): number {
    return (
      Math.sin(this.bobPhase * 0.5) * BOB.amplitude * BOB.sway * this.bobWeight
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function shortestDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function shortestAngle(from: number, to: number, t: number): number {
  return from + shortestDelta(from, to) * t;
}
