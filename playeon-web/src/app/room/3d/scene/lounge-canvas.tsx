"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";
import * as THREE from "three";

import { impact } from "@/lib/haptics";
import type { LyricLine } from "@/lib/lyrics";
import type { RoomGestureKind, RoomPose } from "@/lib/room-protocol";
import type { ChatKind, RemotePose, RoomStore } from "@/lib/room-store";

import { ContentLight, type LightSource } from "../lib/content-light";
import type { Palette } from "../lib/palette";
import { markFrame, markTick } from "../lib/fps";
import { cooldownMs, noCooldowns, type Cooldowns } from "../lib/gestures";
import { ImpactSound } from "../lib/impact-sound";
import { Input } from "../lib/input";
import { Player } from "../lib/player";
import { cushionAtX } from "../lib/seats";
import { SwitchSound } from "../lib/switch-sound";
import {
  BUBBLE,
  BUTTON,
  COUCH,
  GESTURE,
  GOVERNOR,
  SCREEN,
  SWITCH,
  VIEW,
} from "../lib/tuning";
import type { CrowdMember } from "./crowd";
import { LoungeScene } from "./lounge-scene";
import { LyricsBoard } from "./lyrics-board";

export type AimTarget =
  | "seat"
  | "seat-taken"
  | "screen"
  | "screen-far"
  | "switch"
  | "button"
  | "person"
  | null;

export type AimedPerson = { id: string; name: string };

function bubbleLifeMs(kind: ChatKind): number {
  const hold = kind === "emoji" ? BUBBLE.emojiHoldSec : BUBBLE.holdSec;
  return (hold + BUBBLE.fadeSec) * 1000;
}

type Errand = { kind: RoomGestureKind; id: string };

function contactFor(kind: RoomGestureKind): number {
  return GESTURE[kind].contact;
}

function poseOf(player: Player): RoomPose {
  return {
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    seat: player.seated ? player.seat : -1,
  };
}

export type CanvasProps = {
  /** The room's paint - everything the lounge is built out of. */
  paint: Palette;
  player: Player;
  store: RoomStore;
  members: CrowdMember[];
  videoRef: RefObject<HTMLVideoElement | null>;
  inputRef: RefObject<Input | null>;
  mediaKey: string;
  posterUrl: string | null;
  lyrics: LyricLine[] | null;
  textureAllowed: boolean;
  buffering: boolean;
  onTextureResult: (ok: boolean, detail: string) => void;
  onFrameSize: (size: { width: number; height: number }) => void;
  onAimChange: (target: AimTarget) => void;
  onPersonChange: (person: AimedPerson | null) => void;
  onSeatedChange: (seated: boolean) => void;
  onSwitchChange: (on: boolean | null) => void;
  onWatch: () => void;
  onCooldown: (ready: Cooldowns) => void;
  paused: boolean;
};

function World({
  paint,
  player,
  store,
  members,
  videoRef,
  inputRef,
  mediaKey,
  posterUrl,
  lyrics,
  textureAllowed,
  buffering,
  onTextureResult,
  onFrameSize,
  onAimChange,
  onPersonChange,
  onSeatedChange,
  onSwitchChange,
  onWatch,
  onCooldown,
  paused,
}: CanvasProps) {
  const { gl, scene, camera } = useThree();

  const sceneRef = useRef<LoungeScene | null>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const clickRef = useRef<SwitchSound | null>(null);
  const hitRef = useRef<ImpactSound | null>(null);
  const readyAt = useRef<Cooldowns>(noCooldowns());
  const contentRef = useRef<ContentLight | null>(null);

  const facing = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const view = useRef(new THREE.Frustum());
  const viewProjection = useRef(new THREE.Matrix4());
  const bubbleSpot = useRef(new THREE.Vector3());
  const raycaster = useRef(new THREE.Raycaster());
  const centre = useRef(new THREE.Vector2(0, 0));
  const targets = useRef<THREE.Object3D[]>([]);
  const hits = useRef<THREE.Intersection[]>([]);

  const aiming = useRef<AimTarget>(null);
  const aimedAt = useRef<string | null>(null);
  const errand = useRef<Errand | null>(null);
  const crowdRev = useRef(-1);
  const fixtures = useRef<THREE.Object3D[]>([]);
  const shake = useRef({ age: 0, sec: 0, mag: 0 });
  const switched = useRef<boolean | null>(null);
  const seated = useRef(false);
  const uploaded = useRef(false);
  const uploadOk = useRef(false);
  const posterRef = useRef<THREE.Texture | null>(null);
  const lyricsRef = useRef<LyricsBoard | null>(null);
  const shown = useRef<THREE.Texture | null>(null);
  const lastAspect = useRef(0);
  const lightsSeen = useRef(0);
  const anomalySeen = useRef(0);

  const membersRef = useRef(members);
  membersRef.current = members;

  useEffect(() => {
    /*
      The room takes the scene itself, not just a place in it.

      Fog and background used to be declared here as fixed colours, which is
      why the far walls stayed bright with every lamp switched off: fog is
      applied after shading and answers to nothing. It belongs to the room, so
      the room owns it and dims it along with everything else.
    */
    const lounge = new LoungeScene(gl, paint, scene);
    scene.add(lounge.root);
    sceneRef.current = lounge;
    fixtures.current = [
      lounge.seat,
      lounge.picture,
      lounge.button,
      ...lounge.switches,
    ];
    targets.current = fixtures.current;
    crowdRev.current = -1;
    lounge.crowd.sync(membersRef.current);

    return () => {
      sceneRef.current = null;
      fixtures.current = [];
      targets.current = [];
      scene.remove(lounge.root);
      lounge.dispose();
    };
  }, [gl, scene, paint]);

  useEffect(() => {
    const click = new SwitchSound();
    const hit = new ImpactSound();
    clickRef.current = click;
    hitRef.current = hit;
    const arm = () => {
      click.arm();
      hit.arm();
    };
    window.addEventListener("pointerdown", arm, { capture: true });
    window.addEventListener("keydown", arm, { capture: true });
    return () => {
      clickRef.current = null;
      hitRef.current = null;
      window.removeEventListener("pointerdown", arm, { capture: true });
      window.removeEventListener("keydown", arm, { capture: true });
      click.dispose();
      hit.dispose();
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const light = new ContentLight();
    contentRef.current = light;
    return () => {
      contentRef.current = null;
      light.dispose();
    };
  }, []);

  useEffect(() => {
    const board = new LyricsBoard();
    lyricsRef.current = board;
    return () => {
      lyricsRef.current = null;
      if (shown.current === board.texture) {
        shown.current = null;
        sceneRef.current?.setPicture(null);
      }
      board.dispose();
    };
  }, []);

  useEffect(() => {
    const board = lyricsRef.current;
    if (!board) return;
    if (shown.current === board.texture) {
      shown.current = null;
      sceneRef.current?.setPicture(null);
    }
    board.setLines(lyrics);
  }, [lyrics]);

  useEffect(() => {
    const input = new Input(gl.domElement);
    inputRef.current = input;
    return () => {
      inputRef.current = null;
      input.destroy();
    };
  }, [gl, inputRef]);

  useEffect(() => {
    sceneRef.current?.crowd.sync(members);
  }, [members]);

  useEffect(() => () => store.publishPose(null), [store]);

  useEffect(() => {
    if (paused) inputRef.current?.unlock();
    else inputRef.current?.read();
  }, [paused, inputRef]);

  useEffect(() => {
    if (!posterUrl) {
      posterRef.current = null;
      return;
    }

    let cancelled = false;
    let loaded: THREE.Texture | null = null;

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      posterUrl,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        loaded = texture;
        posterRef.current = texture;
      },
      undefined,
      () => {},
    );

    return () => {
      cancelled = true;
      posterRef.current = null;
      if (shown.current === loaded) {
        shown.current = null;
        sceneRef.current?.setPicture(null);
      }
      loaded?.dispose();
    };
  }, [posterUrl]);

  useEffect(() => {
    uploaded.current = false;
    uploadOk.current = false;
    lastAspect.current = 0;

    const video = videoRef.current;
    if (!textureAllowed || !video) {
      return;
    }

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    textureRef.current = texture;

    return () => {
      textureRef.current = null;
      if (shown.current === texture) {
        shown.current = null;
        sceneRef.current?.setPicture(null);
      }
      texture.dispose();
    };
  }, [videoRef, mediaKey, textureAllowed]);

  useFrame((_, delta) => {
    const input = inputRef.current;
    const lounge = sceneRef.current;
    if (!input || !lounge) return;

    if (paused) return;

    const dt = Math.min(0.05, delta);
    const frame = input.read();
    const poses = store.poses();

    const job = errand.current;
    if (job) {
      const mark = poses.get(job.id);
      if (mark) player.approach(mark.x, mark.z, contactFor(job.kind));
      else {
        errand.current = null;
        player.cancelApproach();
      }
    }

    player.step(dt, frame, poses.values());

    if (errand.current && (player.arrived || player.gaveUp)) {
      store.publishPose(poseOf(player), true);
      store.gesture(errand.current.kind, errand.current.id);
      impact("light");
      readyAt.current = {
        ...readyAt.current,
        [errand.current.kind]: Date.now() + cooldownMs(errand.current.kind),
      };
      onCooldown(readyAt.current);
      errand.current = null;
      player.cancelApproach();
    }

    const sway = player.eyeSway();
    camera.position.set(
      player.x + Math.cos(player.yaw) * sway,
      player.eyeY(),
      player.z - Math.sin(player.yaw) * sway,
    );
    let kickYaw = 0;
    let kickPitch = 0;
    const knock = shake.current;
    if (knock.age < knock.sec) {
      knock.age += dt;
      const t = Math.min(1, knock.age / knock.sec);
      const swing = Math.sin(t * Math.PI * 2.5) * Math.exp(-4 * t);
      kickYaw = knock.mag * swing;
      kickPitch = knock.mag * 0.4 * swing;
    }

    facing.current.set(player.pitch + kickPitch, player.yaw + kickYaw, 0);
    camera.quaternion.setFromEuler(facing.current);

    let aim: AimTarget = null;
    let person: AimedPerson | null = null;
    let seat: number | null = null;
    let lamp: number | null = null;
    let lampRange = 0;
    let buttonRange = 0;

    if (!player.settling) {
      if (crowdRev.current !== lounge.crowd.rev) {
        crowdRev.current = lounge.crowd.rev;
        targets.current = [...fixtures.current, ...lounge.crowd.hitboxes()];
      }

      raycaster.current.setFromCamera(centre.current, camera);
      const found = hits.current;
      found.length = 0;
      raycaster.current.intersectObjects(targets.current, false, found);

      let hit: THREE.Intersection | undefined;
      for (const candidate of found) {
        const who = lounge.crowd.personAt(candidate.object);
        if (!who) {
          hit = candidate;
          break;
        }
        if (candidate.distance <= GESTURE.reach) {
          person = who;
          aim = "person";
          break;
        }
      }

      if (person) {
      } else if (hit?.object === lounge.picture) {
        aim =
          player.seated || hit.distance <= SCREEN.reach ? "screen" : "screen-far";
      } else if (typeof hit?.object.userData.lamp === "number") {
        if (hit.distance <= SWITCH.reach) {
          lamp = hit.object.userData.lamp as number;
          lampRange = hit.distance;
          aim = "switch";
        }
      } else if (hit?.object === lounge.button) {
        if (hit.distance <= BUTTON.reach) {
          buttonRange = hit.distance;
          aim = "button";
        }
      } else if (hit && !player.seated && hit.distance <= COUCH.reach) {
        seat = cushionAtX(hit.point.x);
        aim = taken(seat, poses) ? "seat-taken" : "seat";
      }
    }
    if (aim !== aiming.current) {
      aiming.current = aim;
      onAimChange(aim);
    }
    if ((person?.id ?? null) !== aimedAt.current) {
      aimedAt.current = person?.id ?? null;
      onPersonChange(person);
    }

    if (frame.gesture && person && Date.now() >= readyAt.current[frame.gesture]) {
      errand.current = { kind: frame.gesture, id: person.id };
    }

    if (frame.interact && !errand.current) {
      if (aim === "screen") onWatch();
      else if (aim === "switch" && lamp !== null) {
        const on = lounge.toggleLamp(lamp);
        store.setLight(lamp, on);
        clickRef.current?.play(on, lampRange);
      } else if (aim === "button") {
        lounge.startAnomaly();
        store.callAnomaly();
        clickRef.current?.play(true, buttonRange);
      } else if (aim === "seat" && seat !== null) player.sit(seat);
      else if (player.seated) player.stand();
    }

    const lit = lamp === null ? null : lounge.lampOn(lamp);
    if (lit !== switched.current) {
      switched.current = lit;
      onSwitchChange(lit);
    }
    if (frame.stand && !errand.current) player.stand();
    if (player.seated !== seated.current) {
      seated.current = player.seated;
      onSeatedChange(player.seated);
    }

    store.publishPose(poseOf(player));

    const selfId = store.getState().self?.id;
    const stance = selfId
      ? { id: selfId, x: player.x, z: player.z, yaw: player.yaw }
      : undefined;

    for (const gesture of store.takeGestures()) {
      lounge.crowd.playGesture(gesture, stance);

      if (gesture.kind === "slap" || gesture.kind === "kick") {
        const actor = gesture.from === selfId ? player : poses.get(gesture.from);
        const range = actor
          ? Math.hypot(actor.x - player.x, actor.z - player.z)
          : 0;
        hitRef.current?.play(gesture.kind, range);
      }

      if (gesture.to !== selfId) continue;
      if (gesture.kind === "slap") {
        shake.current.age = 0;
        shake.current.sec = GESTURE.slap.recoilSec;
        shake.current.mag = GESTURE.slap.recoil * 0.45;
        impact("heavy");
      } else if (gesture.kind === "kick") {
        const boot = poses.get(gesture.from);
        if (boot) player.launch(player.x - boot.x, player.z - boot.z);
        shake.current.age = 0;
        shake.current.sec = GESTURE.kick.recoilSec;
        shake.current.mag = GESTURE.kick.recoil * 0.5;
        impact("heavy");
      } else {
        impact("soft");
      }
    }

    lounge.crowd.update(dt, poses, store.bubbles());

    const waiting = store.sightings();
    if (waiting.length > 0) {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      viewProjection.current.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      view.current.setFromProjectionMatrix(viewProjection.current);

      const now = Date.now();
      for (let index = waiting.length - 1; index >= 0; index -= 1) {
        const sighting = waiting[index]!;
        const shown = lounge.crowd.bubbleAt(sighting.from, bubbleSpot.current);
        if (shown && view.current.containsPoint(bubbleSpot.current)) {
          store.settle(sighting.id, true);
        } else if (now - sighting.at >= bubbleLifeMs(sighting.kind)) {
          store.settle(sighting.id, false);
        }
      }
    }

    const lightsRev = store.lightsRev();
    if (lightsRev !== lightsSeen.current) {
      lightsSeen.current = lightsRev;
      lounge.setLamps(store.lights());
    }

    const anomalyRev = store.anomalyRev();
    if (anomalyRev !== anomalySeen.current) {
      anomalySeen.current = anomalyRev;
      lounge.startAnomaly();
    }
    lounge.updateAnomaly(dt);
    lounge.step(dt);

    const texture = textureRef.current;
    const video = videoRef.current;

    const hasPicture =
      Boolean(texture) &&
      Boolean(video) &&
      video!.readyState >= 2 &&
      video!.videoWidth > 0;

    if (hasPicture && !uploaded.current) {
      uploaded.current = true;
      try {
        gl.initTexture(texture!);
        uploadOk.current = true;
        onTextureResult(true, "uploaded");
      } catch (error) {
        uploadOk.current = false;
        const detail =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : "upload threw a non-Error";
        onTextureResult(false, detail);
      }
    }

    const board = lyricsRef.current;
    board?.update(
      store.positionSec(),
      (posterRef.current?.image as HTMLImageElement | undefined) ?? null,
    );

    const live = hasPicture && uploadOk.current;

    const stalling = buffering && Boolean(video) && video!.videoWidth > 0;
    lounge.setLoading(buffering, dt);

    const wanted = live
      ? texture
      : stalling
        ? shown.current
        : (board?.texture ?? posterRef.current);

    if (wanted !== shown.current) {
      shown.current = wanted;
      lounge.setPicture(wanted);
      lastAspect.current = 0;
    }

    const content = contentRef.current;
    if (content) {
      const source = lounge.lightsOut ? paintable(wanted) : null;
      if (source) content.read(source, performance.now());
      else content.dim();
      content.step(dt);
      lounge.setContentLight(content.color, content.level);
    }
    if (!wanted) return;

    const width = live ? video!.videoWidth : sourceWidth(wanted);
    const height = live ? video!.videoHeight : sourceHeight(wanted);
    if (width <= 0 || height <= 0) return;

    const aspect = width / height;
    if (aspect !== lastAspect.current) {
      lastAspect.current = aspect;
      lounge.fitPicture(aspect);
      if (live) onFrameSize({ width, height });
    }
  });

  return null;
}

function taken(index: number, poses: ReadonlyMap<string, RemotePose>): boolean {
  for (const pose of poses.values()) {
    if (pose.seat === index) return true;
  }
  return false;
}

type Sized = { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };

function paintable(texture: THREE.Texture | null): LightSource | null {
  const image = texture?.image as unknown;
  if (image instanceof HTMLVideoElement) {
    return image.videoWidth > 0 ? image : null;
  }
  if (image instanceof HTMLImageElement) {
    return image.naturalWidth > 0 ? image : null;
  }
  if (image instanceof HTMLCanvasElement) {
    return image.width > 0 ? image : null;
  }
  return null;
}

function sourceWidth(texture: THREE.Texture): number {
  const image = texture.image as Sized | null;
  return image?.naturalWidth ?? image?.width ?? 0;
}

function sourceHeight(texture: THREE.Texture): number {
  const image = texture.image as Sized | null;
  return image?.naturalHeight ?? image?.height ?? 0;
}

/** The middle value, sorted into a buffer kept for the purpose. */
function median(values: Float64Array, scratch: Float64Array): number {
  scratch.set(values);
  scratch.sort();
  return scratch[scratch.length >> 1]!;
}

function Governor({ paused }: { paused: boolean }) {
  const setDpr = useThree((state) => state.setDpr);
  const native = useThree((state) => state.viewport.initialDpr);

  const paced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches,
    [],
  );

  /*
    How far the ladder is allowed to go.

    A phone stops at its own pixels: there is no headroom there to spend, and
    every rung above native is pixels thrown away on the way to the panel. A
    desktop is allowed past it, because thrown-away pixels are exactly what
    supersampling is - the buffer is averaged down on presentation and the
    aliasing goes with it.

    It is a multiple of the device ratio rather than a number, so a 4K display
    at ratio 2 may reach 3 and a plain one at ratio 1 may reach 1.5; both are
    the same amount of supersampling on top of whatever the panel already is.
  */
  const ceiling = paced
    ? Math.max(native, VIEW.mobileMax)
    : native * VIEW.desktopSuper;

  const rungs = useMemo(
    () => [...GOVERNOR.ladder.filter((rung) => rung < ceiling), ceiling],
    [ceiling],
  );

  /*
    Where the ladder is joined.

    A phone starts at the bottom and everything else at its native ratio, and
    the asymmetry is the whole point. r3f begins at the device's own ratio,
    which on a phone is 2 - four times the pixels of 1, on the hardware least
    able to pay for them, during the seconds when the room is still being built
    and the first video frames are arriving. It could never hold that, so it
    walked down the ladder a rung at a time and *flashed on every step*:
    changing the pixel ratio reallocates the drawing buffer, and with MSAA on an
    opaque canvas that realloc presents one blank frame. Five rungs meant four
    blinks over six seconds, every join, on every phone.

    Starting at the bottom is free - nobody has seen the room yet, so there is
    no drop in quality to notice - and the climb back up only happens after
    `probeSec` of provably spare frames, by which time a resize is a thing that
    happens to a room somebody is already sitting in rather than the first thing
    it does.

    Native, not the top rung, everywhere else. The rungs above native are the
    supersampling ones and they are worth having only out of spare frames, so
    they are climbed to like any other headroom - never opened on, where they
    would be paid for during the join and given back with a blink.
  */
  const start = useMemo(() => {
    if (paced) return 0;
    const at = rungs.findIndex((rung) => rung >= native);
    return at < 0 ? rungs.length - 1 : at;
  }, [paced, rungs, native]);

  /*
    Applied before the first frame, not on it.

    A layout effect lands ahead of r3f's first render, so the buffer is built
    once at the size it is going to be used at. Setting it inside the frame loop
    instead would make the opening resize one more of exactly the blinks this is
    here to remove.

    This one goes through r3f rather than being applied by hand, because there
    is nothing on screen yet for a blank frame to interrupt - and it keeps r3f's
    own idea of the ratio correct for the first frame, which is the one it uses
    to build the buffer.
  */
  useLayoutEffect(() => {
    setDpr(rungs[start]!);
  }, [rungs, start, setDpr]);

  const state = useRef({
    rung: -1,
    cap: Number.POSITIVE_INFINITY,
    ease: 0,
    refresh: 0,
    beats: new Float64Array(GOVERNOR.cadence),
    scratch: new Float64Array(GOVERNOR.cadence),
    beat: 0,
    seen: 0,
    stride: 1,
    tick: 0,
    last: 0,
    hold: GOVERNOR.holdSec,
    calm: 0,
    /** A ratio waiting to be applied at the top of the next frame. */
    pending: 0,
  });

  /*
    A window resize resets what we set by hand.

    r3f re-applies its own stored ratio whenever the canvas changes size, and
    its stored ratio is the one from the layout effect above - so an orientation
    change would quietly drop the room back to its opening rung and leave it
    there, since the ladder only acts when it decides to move. Re-queueing on
    every size change puts it back on the next frame, through the same path as
    every other change.
  */
  const canvas = useThree((state) => state.size);
  useEffect(() => {
    const current = state.current;
    if (current.rung >= 0) current.pending = rungs[current.rung]!;
  }, [canvas, rungs]);

  useFrame(({ gl, scene, camera, size }, delta) => {
    const current = state.current;
    markTick();
    if (current.rung < 0) current.rung = start;

    /*
      Apply a rung change here, at the top of a frame we are about to draw.

      This is the fix for the blink. Changing the pixel ratio reallocates the
      drawing buffer and the new one arrives empty - so the blink was never the
      resize itself, it was the browser being allowed to composite in the gap
      between the realloc and the next time anything drew. Handing the change to
      r3f's `setDpr` guaranteed that gap: it is React state, so the resize lands
      in a commit, and the frame after it is somebody else's.

      Done here the gap does not exist. The buffer is reallocated and painted
      inside one callback, before the browser is given a chance to show anything,
      so what gets presented is the first frame at the new ratio rather than the
      empty buffer that preceded it.

      `setSize` with `false` leaves the canvas's CSS size alone - only the
      backing store changes, which is the entire point of a pixel ratio.
    */
    if (current.pending > 0) {
      gl.setPixelRatio(current.pending);
      gl.setSize(size.width, size.height, false);
      current.pending = 0;
    }

    const vsync = delta * 1000;

    /*
      The display's cadence, as the median of the last `cadence` frame times.

      It used to be the *smallest* frame time ever seen, agreed by eight
      callbacks, and that estimator could only ever be wrong in one direction
      and never take it back. Two properties made it fail together. The minimum
      never rose, so a single short callback - the one after a stall, or the one
      r3f emits when `setDpr` reallocates the drawing buffer - moved it down for
      the rest of the session. And the agreement count was never reset by
      ordinary frames: an 11 ms callback matched neither branch, so it left the
      tally untouched. Eight stray short frames spread over an entire session
      therefore accumulated as if they had arrived in a row, latched `refresh`
      to its 6 ms clamp, and set `stride` to `floor(20 / 6)` = 3. From then on a
      90 Hz phone rendered every third callback - 30 fps, for good, with no way
      back, and heavy movement only decided how soon it happened.

      A median cannot be moved by outliers that are not the majority of the
      window, and unlike a minimum it can rise: a panel that drops from 90 Hz to
      60 under thermal load is followed rather than treated as permanent
      slowness. Frame times that are obviously not a cadence are not even
      offered to it, and the stride it produces is capped at every other frame.
    */
    if (vsync >= GOVERNOR.shortestMs && vsync <= GOVERNOR.longestMs) {
      current.beats[current.beat % GOVERNOR.cadence] = vsync;
      current.beat += 1;
      if (current.seen < GOVERNOR.cadence) current.seen += 1;

      if (
        current.seen === GOVERNOR.cadence &&
        current.beat % GOVERNOR.recheck === 0
      ) {
        const middle = median(current.beats, current.scratch);
        if (Math.abs(middle - current.refresh) > GOVERNOR.cadenceSlack) {
          current.refresh = middle;
          current.stride = paced
            ? Math.min(
                GOVERNOR.maxStride,
                Math.max(
                  1,
                  Math.floor((GOVERNOR.targetMs * GOVERNOR.strideSlack) / middle),
                ),
              )
            : 1;
          current.tick = 0;
          current.ease = 0;
        }
      }
    }

    current.tick += 1;
    if (current.tick < current.stride) return;
    current.tick = 0;

    gl.render(scene, camera);
    markFrame(gl);

    if (paused || rungs.length < 2 || current.refresh === 0) return;

    const now = performance.now();
    const interval = current.last === 0 ? 0 : now - current.last;
    current.last = now;
    if (interval <= 0 || interval > 250) return;

    current.ease =
      current.ease === 0
        ? interval
        : current.ease + (interval - current.ease) * GOVERNOR.ease;

    /*
      What a frame is allowed to take: the display's cadence, but never less
      than `targetMs`.

      Without the floor the budget is whatever the panel happens to offer, and
      the ladder chases it. On a 94 Hz phone that is a 10.6 ms budget - the
      governor spends resolution until the room can be drawn in ten
      milliseconds, and the room goes soft to buy frames past the point where
      another frame is worth anything. The panel's rate is not a target; it is
      the ceiling on how often a target can be met.

      Sixty is the target, so sixty is the floor. Above it the ladder climbs
      while frames still fit, which is where the sharpness comes from; below it
      the frames really are late and it steps down as before. Rendering is
      unaffected either way - the stride decides how often the scene is drawn,
      this decides only how much detail each drawing is worth.
    */
    const budget = Math.max(
      current.refresh * current.stride,
      GOVERNOR.targetMs,
    );
    const seconds = interval / 1000;
    current.hold -= seconds;
    current.calm += seconds;

    const slow = current.ease > budget * GOVERNOR.slowAt;
    if (slow) current.calm = Math.max(0, current.calm - GOVERNOR.calmPenaltySec);
    else if (current.calm > GOVERNOR.probeSec) {
      current.cap = Number.POSITIVE_INFINITY;
      current.calm = 0;
    }

    if (current.hold > 0) return;

    const roof = Math.min(rungs.length - 1, current.cap);
    let next = current.rung;
    if (slow && current.rung > 0) {
      /*
        Down to the rung the measurement actually supports, not down by one.

        Shading cost goes with the pixel count, which goes with the square of
        the ratio - so the ratio that fits inside the budget is this one scaled
        by the square root of how far over it we are. A device at twice its
        budget lands three rungs lower in one step instead of taking three
        steps, three holds and three blinks to arrive at the same place.

        Never less than one rung, so a marginal overrun still makes progress,
        and the result is capped until `probeSec` of calm frames earns a retry.
      */
      const fit = rungs[current.rung]! * Math.sqrt(budget / current.ease);
      next -= 1;
      while (next > 0 && rungs[next]! > fit) next -= 1;
      current.cap = next;
    } else if (
      current.rung < roof &&
      (current.ease < budget * GOVERNOR.spareAt ||
        (current.cap === Number.POSITIVE_INFINITY &&
          current.ease <= current.refresh * GOVERNOR.lockedSlack))
    ) {
      /*
        Two ways up, because one of them cannot see.

        The first is measured slack: a frame comfortably inside budget means the
        rung above is worth trying.

        The second exists because a phone locked to its panel measures the panel
        and nothing else. A 60 Hz device drawing its frame in three milliseconds
        still reports 16.7, so it never shows slack and would sit at the bottom
        rung for ever with the GPU idle. When the frame time is sitting on the
        cadence itself, the only way to find out what the device can do is to
        take a rung and watch - but only while `cap` is still infinite, which is
        to say only until something fails. After the first failure the ladder
        has learned where the limit is, and probing again would just be a blink
        every probe interval for a rung it already knows it cannot hold.

        Scaling `ease` by the square of the ratio looks like the obvious mirror
        of the step down, and it is wrong here, because `ease` is not a
        measurement of work. Frames present on vsync, so a device with a
        completely idle GPU still measures one panel interval per frame and
        nothing shorter. Multiply that floor by the 1.56 a rung costs and it
        always exceeds the budget - so a phone with four times the headroom it
        needs reads as having none, never climbs, and sits at the bottom of the
        ladder rendering a blurry room while the GPU idles. That is what this
        did: 114 fps at ×2 became 84 at ×1.

        There is no way to see headroom through a quantised clock. So the ladder
        probes instead of predicting: it takes a rung, and if the frame really
        was too expensive the interval jumps a whole vsync - which is
        unmissable - and the step down puts it back and caps it there for
        `probeSec`. One overshoot, corrected, beats never climbing at all.
      */
      next += 1;
    }
    if (next === current.rung) return;

    current.rung = next;
    current.hold = GOVERNOR.holdSec;
    current.ease = 0;
    // queued rather than applied: see the top of this callback
    current.pending = rungs[next]!;
  }, 1);

  return null;
}

const VIGNETTE =
  "radial-gradient(ellipse farthest-corner at 50% 50%," +
  " rgba(0,0,0,0) 44%," +
  " rgba(0,0,0,0.005) 50%," +
  " rgba(0,0,0,0.036) 60%," +
  " rgba(0,0,0,0.090) 70%," +
  " rgba(0,0,0,0.165) 80%," +
  " rgba(0,0,0,0.259) 90%," +
  " rgba(0,0,0,0.373) 100%)";

export const LoungeCanvas = memo(function LoungeCanvas(props: CanvasProps) {
  return (
    <div
      className="absolute inset-0 transform-gpu [contain:paint] [will-change:transform]"
    >
      <Canvas
        frameloop={props.paused ? "never" : "always"}
        dpr={[1, VIEW.maxDpr]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.NoToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        camera={{
          fov: VIEW.fov,
          near: VIEW.near,
          far: VIEW.far,
          position: [0, 1.7, 4.2],
        }}
      >
        <World {...props} />
        <Governor paused={props.paused} />
      </Canvas>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: VIGNETTE }}
      />
    </div>
  );
});
