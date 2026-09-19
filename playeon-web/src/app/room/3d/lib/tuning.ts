export const WORLD = {
  halfX: 7,
  halfZ: 5.5,
  /**
   * Floor to ceiling.
   *
   * Started at 3.6, which was a room you could feel the lid of: standing eye
   * height is 1.7, so the ceiling sat barely a person above your head and every
   * lamp was in the top of frame the moment you looked up from the screen.
   *
   * 4.0 is a shade under two and a half people, which is a hall rather than a
   * flat, and that is the right reference for a room with a five-metre screen
   * and a couch for six in it. What stops a space reading as cramped is not
   * floor area - it has plenty - but how much wall there is above the things
   * standing against it, and that is all this number buys.
   */
  height: 4.0,
} as const;

export const ROOM = {
  skirtY: 0.14,
  skirtDepth: 0.04,
  /**
   * How far the band around the ceiling hangs below it.
   *
   * 0.18 was a beam. At that depth the band reads as structure holding the
   * ceiling up, and it eats the top of the wall on every side - which is the
   * height the room was just given. 0.1 is a trim detail: still a shadow line
   * that stops the ceiling meeting the wall in a bare corner, but nothing you
   * would describe as a beam.
   */
  soffitDrop: 0.1,
  /** How far in from the wall the band reaches - its width, not its depth. */
  soffitReach: 0.9,
  lampRadius: 0.09,
  /**
   * How far the lamps hang below the ceiling.
   *
   * Was 0.3, which on a dark ceiling was invisible and on a pale one is the
   * whole problem: a point light 30 cm from a white surface burns a hard pool
   * into it, and five of them turn the ceiling into the brightest thing in the
   * room. Dropping them to 0.55 spreads each pool over roughly three times the
   * area at a third the peak, which is what a ceiling fitting actually looks
   * like - and it lights the room rather than the lid.
   */
  lampDrop: 0.55,
  /*
    The rug's width is the couch's, and is taken from `COUCH.width` at the point
    it is built rather than stated here.

    Two numbers that have to match are one number, and this is the pair that
    proves it: the couch went from 4 to 5.8 when it grew to six seats, and a rug
    written as 6.4 quietly stopped being the couch's footprint and started being
    an oblong the couch sat inside off-centre. Derived, it cannot fall out of
    step again - and `COUCH` is declared after `ROOM` in this file, so the
    reference lives in the scene rather than up here.
  */
  rugDepth: 3.4,
  rugZ: -2.4,
  rugLift: 0.008,
} as const;

export const SCREEN = {
  width: 4.8,
  height: 2.7,
  /**
   * Height of the middle of the picture. Fixed, not half the room.
   *
   * It was `WORLD.height / 2`, which meant the screen climbed the wall every
   * time the ceiling went up - and a television's height has nothing to do with
   * the ceiling and everything to do with the people watching it. Standing eye
   * height is 1.7 and the couch puts you lower again, so a centre a little
   * above 1.7 is a screen you look slightly up at from a seat and level at on
   * your feet. Raising the room now adds wall above it, which is the part that
   * reads as height.
   */
  centreY: 1.95,
  standoff: 0.06,
  bezel: 0.08,
  depth: 0.09,
  lift: 0.012,
  /**
   * How far the panel sits behind the frame's front face.
   *
   * The picture used to sit 12 mm *in front* of the bezel, which is fine
   * head-on and wrong from anywhere else: seen from the side it floated clear
   * of the frame instead of being held by it. A television is the other way
   * round - the glass is at the bottom of a shallow recess and the surround
   * laps over its edge - so the frame is a frame now, with a hole in it, and
   * this is how deep the hole goes.
   */
  recess: 0.03,
  /** How far the frame laps over the panel's edge, holding it in. */
  overlap: 0.007,
  /**
   * Corner radius of the panel's active area - the black and the picture both.
   *
   * Small: a screen with obviously rounded corners is a phone. This is the
   * couple of millimetres a real panel takes off the corner so the glass does
   * not end in a point, and at this distance it reads as the thing being made
   * rather than drawn.
   *
   * The bezel's outer corner is this plus `bezel`, so the frame stays the same
   * width all the way round - one number sets both, and they cannot drift.
   */
  corner: 0.045,
  glowDistance: 7,
  glow: 1.5,
  contentGlow: 4.2,
  contentDistance: 16,
  contentWash: 0.26,
  contentHz: 10,
  contentEase: 5,
  contentSaturation: 1.7,
  contentFullAt: 0.55,
  loaderRadius: 0.26,
  loaderWidth: 0.05,
  loaderSpin: 3.4,
  reach: 3.5,
} as const;

export const COUCH = {
  x: 0,
  z: -1,
  /**
   * Wide enough for `seats` cushions at the pitch a person needs.
   *
   * Derived, not chosen: `seats.ts` divides whatever is left after the arms by
   * the seat count, so the two numbers move together. At 5.8 and six seats the
   * pitch is the 0.89 m it was at 4 and four - six people sit as comfortably as
   * four did rather than six being squeezed onto the same couch.
   */
  width: 5.8,
  depth: 1.05,
  seatY: 0.52,
  backY: 1.02,
  backDepth: 0.22,
  armWidth: 0.22,
  armY: 0.72,
  seats: 6,
  sitEyeY: 0.74,
  reach: 3.2,
} as const;

/**
 * The low table in front of the couch, and the remote sitting on it.
 *
 * Every measurement here is a half-extent or an inset, and the scene builds it
 * by looping over ±1 in both axes rather than by placing four legs at four
 * written-out positions. Symmetry that comes from the arithmetic cannot be
 * broken by a typo in one of the four.
 *
 * `z` puts it between the couch's front edge and the screen, centred on
 * `COUCH.x` so it lines up with the couch and the rug.
 */
export const STOOL = {
  z: -2.55,
  width: 1.24,
  depth: 0.56,
  /** Top of the tabletop. Coffee-table height, well below the seat. */
  height: 0.42,
  topThickness: 0.055,
  legSize: 0.075,
  /** How far a leg's outer face sits inside the tabletop's edge. */
  legInset: 0.085,
  radius: 0.02,
} as const;

export const REMOTE = {
  width: 0.055,
  length: 0.185,
  thickness: 0.018,
  radius: 0.008,
  /** Rotation on the tabletop - a remote nobody has squared up. */
  yaw: 0.22,
  keySize: 0.013,
  keyGap: 0.026,
  keyRows: 3,
} as const;

export const SWITCH = {
  /**
   * On the screen's wall, off its left shoulder.
   *
   * Where a light switch belongs is next to the thing the lights are for, and
   * in this room that is the screen. It used to be on the side wall by the spawn
   * point, which is the first place you happen to be rather than anywhere you
   * would look for it.
   *
   * The x position is not written here because it depends on how wide the plate
   * turns out to be, and that is decided by the number of lamps - the scene
   * measures the plate and sets the gap off the bezel's edge.
   */
  screenGap: 0.42,
  y: 1.55,
  pitch: 0.105,
  border: 0.028,
  gap: 0.003,
  plateD: 0.01,
  frameD: 0.022,
  rockerW: 0.085,
  rockerH: 0.125,
  rockerD: 0.02,
  tilt: 0.107,
  screwR: 0.006,
  screwD: 0.0015,
  reach: 2.4,
} as const;

export const ANOMALY = {
  duration: 25,
  flickerAt: 0,
  flickerIn: 2.5,
  flickerFloor: 0.18,
  flickerHoldMin: 0.035,
  flickerHoldSpread: 0.075,
  deadLampShare: 0.36,
  healAt: 19,
  healOut: 5,
} as const;

export const BUTTON = {
  wall: -1,
  z: -0.6,
  y: 1.55,
  plateW: 0.11,
  plateH: 0.11,
  plateD: 0.012,
  radius: 0.032,
  depth: 0.022,
  travel: 0.011,
  release: 0.22,
  reach: 2.4,
} as const;

/**
 * How bright the room is, not what colour it is.
 *
 * The colours moved to `palette.ts` when styles arrived, and the split is the
 * useful one: brightness is behaviour that the switches, the anomaly and the
 * screen glow all reason about, and none of them should change because somebody
 * repainted the room.
 */
export const LIGHTS = {
  lamp: 13.5,
  fillOn: 0.58,
  /**
   * The bounce and ambient left when every lamp is off.
   *
   * 0.07 and 0.03 were "lights off" the way a cinema has them off - you could
   * still read the walls, and in a room whose surfaces are near-white and
   * return almost everything they are given, you could read them easily. The
   * switches exist to be able to put the room out, and the last one should
   * mean it.
   */
  fillOff: 0.016,
  ambientOn: 0.19,
  ambientOff: 0.008,
} as const;

export const ROUND = {
  segments: 3,
  couchBase: 0.06,
  cushion: 0.05,
  backrest: 0.07,
  arm: 0.09,
  rocker: 0.003,
} as const;

export const PLAYER = {
  eyeHeight: 1.7,
  height: 1.8,
  radius: 0.35,
  walkSpeed: 4.4,
  accel: 50,
  friction: 14,
  airControl: 0.28,
  gravity: 24,
  jumpSpeed: 7.4,
  jumpBufferSec: 0.12,
  coyoteSec: 0.1,
  sitBlendSec: 0.26,
} as const;

export const LOOK = {
  mouse: 0.0031,
  drag: 0.0036,
  touch: 0.0059,
  maxPitch: (85 * Math.PI) / 180,
} as const;

export const BOB = {
  amplitude: 0.045,
  sway: 0.55,
  perMetre: 5.2,
  settle: 9,
} as const;

export const MOVE = {
  stickRadius: 68,
  stickDeadzone: 0.14,
  clickSlop: 6,
  tapSlop: 12,
} as const;

export const BODY = {
  legW: 0.26,
  legH: 0.8,
  legD: 0.3,
  torsoW: 0.52,
  torsoH: 0.62,
  torsoD: 0.3,
  armW: 0.17,
  armH: 0.62,
  armD: 0.26,
  headW: 0.38,
  headH: 0.34,
  headD: 0.34,

  hipY: 0.8,
  hipX: 0.13,
  shoulderY: 1.42,
  shoulderX: 0.345,
  torsoY: 1.11,
  headY: 1.59,

  skin: "#e9c33c",
  legs: "#2f3a56",
  face: "#1b1b22",

  radius: 0.4,
} as const;

export const BODY_HEIGHT = BODY.headY + BODY.headH / 2;

const SWING = 0.42;

export const CROWD = {
  smooth: 14,
  legSwing: SWING,
  armSwing: SWING * 0.8,
  gaitPerMetre: (Math.PI * 2) / (2 * (2 * BODY.legH * Math.sin(SWING))),
  gaitRise: BODY.legH * (1 - Math.cos(SWING)),
  walking: 0.25,
  tagY: 2.0,
  tagHeight: 0.19,
  shirt: { saturation: 0.62, lightness: 0.52 },
  idle: { saturation: 0.14, lightness: 0.3 },
  idleTagOpacity: 0.5,
  idleDot: "#f5a939",
  idleDotR: 3.6,
  idleDotGap: 5,
} as const;

export const BUBBLE = {
  y: CROWD.tagY + CROWD.tagHeight / 2 + 0.05,
  height: 0.135,
  emojiHeight: 0.46,
  holdSec: 5,
  emojiHoldSec: 2.8,
  popSec: 0.22,
  fadeSec: 0.45,
  driftM: 0.18,
  overshoot: 0.16,
} as const;

const TOUCHING = PLAYER.radius + BODY.radius;

export const GESTURE = {
  reach: 2.2,
  approach: {
    speed: 3.4,
    turn: 7,
    aim: 0.14,
    timeoutSec: 3,
    stallSec: 0.45,
    progressM: 0.02,
  },
  slap: {
    sec: 0.55,
    lift: 2.3,
    across: 1.1,
    lean: 0.16,
    recoil: 0.3,
    recoilSec: 0.45,
    contact: TOUCHING + 0.2,
    cooldownSec: 3,
  },
  kiss: {
    sec: 0.9,
    lean: 0.26,
    armBack: 0.5,
    heartY: 1.85,
    heartRise: 0.55,
    contact: TOUCHING + 0.05,
    cooldownSec: 3,
  },
  hug: {
    sec: 1.1,
    forward: 1.5,
    squeeze: 0.5,
    lean: 0.12,
    contact: TOUCHING + 0.08,
    cooldownSec: 3,
  },
  kick: {
    sec: 0.6,
    windUp: 0.8,
    swing: 1.5,
    lean: 0.2,
    armCounter: 0.45,
    recoil: 0.34,
    recoilSec: 0.6,
    contact: TOUCHING + 0.35,
    cooldownSec: 5,
    launchSpeed: 8.2,
    launchLift: 3.6,
  },
} as const;

export const SIT = {
  leg: Math.PI / 2,
  arm: 0.22,
} as const;

export const VIEW = {
  fov: 75,
  near: 0.05,
  far: 60,
  maxDpr: 2,
  maxAnisotropy: 8,
  /**
   * How far above the device's own ratio the ladder may climb, on a machine
   * with a pointer that is not a finger.
   *
   * At the device ratio the buffer is exactly the panel's pixels, and edges -
   * the bezel, the switch plates, the couch piping - are as good as they get by
   * resolution alone. Above it the extra pixels are thrown away on the way to
   * the screen, which is the point: they are averaged down, and that average is
   * supersampling. 1.5 is 2.25 times the pixels for the last of the aliasing.
   *
   * Only reachable when the frames are already inside budget, so it is spent
   * out of headroom that exists or not at all. Phones do not get it: there is
   * none there to spend.
   */
  desktopSuper: 1.5,
  /**
   * The highest ratio a phone may reach, if it turns out it can hold it.
   *
   * Above the device's own ratio, so the extra pixels are supersampling exactly
   * as they are on a desktop. Reachable rather than granted: the ladder still
   * has to measure its way up there a rung at a time, and stops at whatever
   * rung keeps the frames inside budget - a phone that cannot hold 2.5 never
   * sees it, and pays nothing for the rungs it never takes.
   */
  mobileMax: 2.5,
} as const;

export const GOVERNOR = {
  /**
   * The pixel ratios the governor is allowed to pick from.
   *
   * Filtered against the ceiling in use, so a phone stops at its own device
   * ratio and never sees the rungs above 2 - those exist for the desktop's
   * supersampling headroom, `VIEW.desktopSuper`.
   */
  ladder: [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75],
  targetMs: 1000 / 60,
  strideSlack: 1.2,
  ease: 0.1,
  /**
   * When a frame counts as late enough to give up a rung: below 60 fps, and
   * not a millisecond sooner.
   *
   * 1.35 meant the ladder tolerated 44 fps before doing anything, which is a
   * long way past the point the room stops feeling smooth. 1.05 is 60 fps with
   * a hair of slack - enough that a display sitting exactly on the 16.67 ms
   * vsync boundary is not read as late by a rounding error, and nothing more.
   */
  slowAt: 1.05,
  /**
   * When there is enough headroom to try the rung above: 75 fps or better.
   *
   * Below `slowAt` by a wide margin on purpose. The two thresholds are the
   * edges of the band the ladder holds still in, and if they sat close together
   * a room drawing at exactly 60 would qualify to climb, fail, drop back, and
   * do it again every hold - the frame rate would spend its life stepping over
   * the line rather than sitting anywhere. Climb only from real slack; hold
   * anywhere between 60 and 75; give up a rung only below 60.
   */
  spareAt: 0.8,
  /** How close to the measured cadence still counts as "locked to the panel". */
  lockedSlack: 1.06,
  holdSec: 1.5,
  /**
   * Calm frames needed before a capped ladder may try the rung above again.
   *
   * Was 30, which in practice meant never. The counter was reset to zero by a
   * single slow frame, and a phone has a slow frame every few seconds - a
   * texture upload, a collection, a websocket burst - so half a minute of
   * unbroken calm was a condition that could go a whole session without being
   * met. The ladder would take one bad patch in the first seconds after joining
   * and stay pinned below its rung for good.
   */
  probeSec: 10,
  /**
   * How much calm a slow frame costs, instead of all of it.
   *
   * A hitch should set the probe back, not erase it. Two seconds is enough that
   * a genuinely struggling room never reaches the probe - slow frames arrive
   * faster than it accrues - while an isolated stutter only delays it.
   */
  calmPenaltySec: 2,

  /** Frame times sampled per cadence estimate, and frames between estimates. */
  cadence: 31,
  recheck: 15,
  /**
   * Frame times outside this are not the display's cadence.
   *
   * Nothing presents faster than 150 Hz, so anything under `shortestMs` is a
   * catch-up callback after a stall or the frame that follows a buffer realloc,
   * and anything over `longestMs` is the stall itself. Both are things that
   * happen *to* the cadence rather than being it.
   */
  shortestMs: 6.5,
  longestMs: 100,
  /** How far the estimate must move before the stride is worth recomputing. */
  cadenceSlack: 0.75,
  /**
   * Draw every callback the display offers.
   *
   * The stride exists to pace a fast panel down towards `targetMs`, and at 1 it
   * is switched off: the room renders at whatever rate the phone is offered.
   *
   * Off because the pacing is a cliff, not a slope. It can only halve, so a
   * 94 Hz panel is either 94 or 47 with nothing in between, and the threshold
   * it decides on - `floor(20 / refresh)`, which flips at exactly 10 ms - falls
   * right where the common 90-to-100 Hz panels sit. A phone parked on the
   * boundary does not settle on either: each re-estimate lands on a different
   * side and the frame rate steps between the two, which reads as far worse
   * than the higher rate costs.
   *
   * The knob that remains is the ladder, which trades resolution rather than
   * frames and does it a rung at a time. Raise this to 2 to bring pacing back
   * for high-refresh phones, but give the threshold hysteresis first.
   */
  maxStride: 1,
} as const;
