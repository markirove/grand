import * as THREE from "three";

import { avatarHue } from "@/lib/avatar";
import type { RoomGesture, RoomGestureKind } from "@/lib/room-protocol";
import type { Bubble as SaidBubble, RemotePose } from "@/lib/room-store";

import {
  clearGestureFrame,
  emptyGestureFrame,
  gestureDelay,
  gestureFrame,
  gestureSec,
  type GestureAim,
  type GestureFrame,
  type GestureRole,
  type GestureSide,
} from "../lib/gestures";
import { seatAt } from "../lib/seats";

import { BODY, BODY_HEIGHT, BUBBLE, COUCH, CROWD, GESTURE, SIT } from "../lib/tuning";
import { Bubble } from "./bubbles";

export type CrowdMember = {
  id: string;
  name: string;
  present: boolean;
};

type Body = {
  id: string;
  name: string;
  present: boolean;
  root: THREE.Group;
  frame: THREE.Group;
  lean: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  hitbox: THREE.Mesh;
  speech: Bubble;
  said: string | null;
  spark: Bubble;
  act: Act | null;
  tag: THREE.Sprite;
  tagMaterial: THREE.SpriteMaterial;
  tagTexture: THREE.CanvasTexture;
  shirt: THREE.MeshStandardMaterial;
  hue: number;

  x: number;
  y: number;
  z: number;
  yaw: number;
  sit: number;
  seatY: number;
  walk: number;
  phase: number;
  placed: boolean;
  snap: boolean;
};

type Act = {
  kind: RoomGestureKind;
  role: GestureRole;
  aim: GestureAim;
  age: number;
  delay: number;
  sec: number;
};

/** Enough of a body to do the geometry with - the local player has no other. */
export type Stance = { id: string; x: number; z: number; yaw: number };

function bearingTo(from: Stance, to: Stance): number {
  const want = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  let delta = (want - from.yaw) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * How much of the blow lands across the target rather than through them.
 *
 * A hand travels across the actor's body, so a right-arm slap pushes towards
 * the actor's left; a boot travels straight out in front of them. Either way
 * what the recoil needs is that direction resolved against the *target's*
 * facing, which is what decides whether their head snaps left or right.
 */
function shoveOn(
  actor: Stance,
  target: Stance,
  kind: RoomGestureKind,
  side: GestureSide,
): number {
  let px: number;
  let pz: number;
  if (kind === "kick") {
    px = -Math.sin(actor.yaw);
    pz = -Math.cos(actor.yaw);
  } else {
    const sweep = side === 1 ? -1 : 1;
    px = sweep * Math.cos(actor.yaw);
    pz = sweep * -Math.sin(actor.yaw);
  }
  return px * Math.cos(target.yaw) + pz * -Math.sin(target.yaw);
}

function limb(w: number, h: number, d: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(0, -h / 2, 0);
  return geometry;
}

function faceTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = BODY.skin;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = BODY.face;
  const eyeY = size * 0.42;
  const eyeR = size * 0.062;
  for (const x of [size * 0.33, size * 0.67]) {
    ctx.beginPath();
    ctx.ellipse(x, eyeY, eyeR, eyeR * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = BODY.face;
  ctx.lineWidth = size * 0.045;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.55, size * 0.16, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function nameTexture(name: string, idle: boolean): THREE.CanvasTexture {
  const text = name.trim().slice(0, 18) || "Someone";
  const scale = 3;
  const font = `600 ${16 * scale}px ui-sans-serif, system-ui, sans-serif`;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const padding = 10 * scale;
  const radius = CROWD.idleDotR * scale;
  const lead = idle ? radius * 2 + CROWD.idleDotGap * scale : 0;
  const width = Math.ceil(measure.measureText(text).width + padding * 2 + lead);
  const height = 26 * scale;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(8,8,14,0.62)";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, height / 2);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, width, height);
  }

  if (idle) {
    ctx.fillStyle = CROWD.idleDot;
    ctx.beginPath();
    ctx.arc(padding + radius, height / 2, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = font;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, (width + lead) / 2, height / 2 + scale);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

export class Crowd {
  readonly root = new THREE.Group();

  rev = 0;

  private readonly bodies = new Map<string, Body>();

  private readonly torsoGeo: THREE.BoxGeometry;
  private readonly headGeo: THREE.BoxGeometry;
  private readonly armGeo: THREE.BoxGeometry;
  private readonly legGeo: THREE.BoxGeometry;

  private readonly skin: THREE.MeshStandardMaterial;
  private readonly trousers: THREE.MeshStandardMaterial;
  private readonly faceMaterial: THREE.MeshStandardMaterial;
  private readonly faceMap: THREE.CanvasTexture;
  private readonly headMaterials: THREE.MeshStandardMaterial[];

  private readonly hitGeo: THREE.CylinderGeometry;
  private readonly hitMaterial: THREE.MeshBasicMaterial;

  private readonly acting: GestureFrame = emptyGestureFrame();

  constructor() {
    this.torsoGeo = new THREE.BoxGeometry(
      BODY.torsoW,
      BODY.torsoH,
      BODY.torsoD,
    );
    this.headGeo = new THREE.BoxGeometry(BODY.headW, BODY.headH, BODY.headD);
    this.armGeo = limb(BODY.armW, BODY.armH, BODY.armD);
    this.legGeo = limb(BODY.legW, BODY.legH, BODY.legD);

    this.skin = new THREE.MeshStandardMaterial({
      color: BODY.skin,
      roughness: 0.85,
      metalness: 0,
    });
    this.trousers = new THREE.MeshStandardMaterial({
      color: BODY.legs,
      roughness: 0.9,
      metalness: 0,
    });

    this.hitGeo = new THREE.CylinderGeometry(BODY.radius, BODY.radius, BODY_HEIGHT, 8, 1);
    this.hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

    this.faceMap = faceTexture();
    this.faceMaterial = new THREE.MeshStandardMaterial({
      map: this.faceMap,
      roughness: 0.85,
      metalness: 0,
    });
    this.headMaterials = [
      this.skin,
      this.skin,
      this.skin,
      this.skin,
      this.skin,
      this.faceMaterial,
    ];
  }

  sync(members: CrowdMember[]): void {
    const seen = new Set<string>();

    for (const member of members) {
      seen.add(member.id);
      const existing = this.bodies.get(member.id);
      if (!existing) {
        this.bodies.set(member.id, this.build(member));
        this.rev += 1;
        continue;
      }
      if (existing.name !== member.name) {
        existing.name = member.name;
        this.retag(existing);
      }
      if (existing.present !== member.present) {
        existing.present = member.present;
        this.applyPresence(existing);
        this.retag(existing);
      }
    }

    for (const [id, body] of this.bodies) {
      if (seen.has(id)) continue;
      this.bodies.delete(id);
      this.destroy(body);
      this.rev += 1;
    }
  }

  hitboxes(): THREE.Object3D[] {
    return [...this.bodies.values()].map((body) => body.hitbox);
  }

  bubbleAt(id: string, out: THREE.Vector3): boolean {
    const body = this.bodies.get(id);
    if (!body?.root.visible) return false;
    out.set(body.x, body.frame.position.y + BUBBLE.y, body.z);
    return true;
  }

  personAt(object: THREE.Object3D): { id: string; name: string } | null {
    const id = object.userData.person;
    if (typeof id !== "string") return null;
    const body = this.bodies.get(id);
    if (!body?.root.visible) return null;
    return { id: body.id, name: body.name };
  }

  playGesture(gesture: RoomGesture, self?: Stance): void {
    const actorBody = this.bodies.get(gesture.from);
    const targetBody = this.bodies.get(gesture.to);
    if (actorBody) actorBody.snap = true;

    // Whichever half has no body is the viewer, who is drawn from their own
    // controller and never appears in the crowd.
    const actor = actorBody ?? (self?.id === gesture.from ? self : undefined);
    const target = targetBody ?? (self?.id === gesture.to ? self : undefined);

    let toTarget = 0;
    let toActor = 0;
    let push = 0;
    if (actor && target) {
      toTarget = bearingTo(actor, target);
      toActor = bearingTo(target, actor);
      push = shoveOn(actor, target, gesture.kind, toTarget <= 0 ? 1 : 0);
    }

    this.start(actorBody, gesture.kind, "actor", { bearing: toTarget, push: 0 });
    this.start(targetBody, gesture.kind, "target", {
      bearing: toActor,
      push,
    });

    if (gesture.kind === "kiss") {
      const from = this.bodies.get(gesture.from);
      if (from?.root.visible) {
        from.spark.show(
          "❤️",
          "emoji",
          GESTURE.kiss.heartY,
          GESTURE.kiss.heartRise,
        );
      }
    }
  }

  private start(
    body: Body | undefined,
    kind: RoomGestureKind,
    role: GestureRole,
    aim: GestureAim,
  ): void {
    if (!body?.root.visible) return;
    body.act = {
      kind,
      role,
      aim,
      age: 0,
      delay: gestureDelay(kind, role),
      sec: gestureSec(kind, role),
    };
  }

  update(
    dt: number,
    poses: ReadonlyMap<string, RemotePose>,
    said: ReadonlyMap<string, SaidBubble>,
  ): void {
    const k = 1 - Math.exp(-CROWD.smooth * dt);

    for (const body of this.bodies.values()) {
      const pose = poses.get(body.id);
      if (!pose) {
        body.root.visible = false;
        body.placed = false;
        body.act = null;
        body.speech.clear();
        body.spark.clear();
        continue;
      }

      body.root.visible = true;

      const message = said.get(body.id);
      if (message && message.id !== body.said) {
        body.said = message.id;
        const fresh =
          (Date.now() - message.at) / 1000 <
          (message.kind === "emoji" ? BUBBLE.emojiHoldSec : BUBBLE.holdSec);
        if (fresh) body.speech.show(message.text, message.kind);
      }
      body.speech.update(dt);
      body.spark.update(dt);

      if (!body.placed) {
        body.placed = true;
        body.x = pose.x;
        body.y = pose.y;
        body.z = pose.z;
        body.yaw = pose.yaw;
        body.sit = pose.seat >= 0 ? 1 : 0;
        body.seatY = seatAt(pose.seat)?.y ?? COUCH.seatY;
      }

      const wasX = body.x;
      const wasZ = body.z;
      const catchUp = body.snap ? 1 : k;
      body.snap = false;
      body.x += (pose.x - body.x) * catchUp;
      body.y += (pose.y - body.y) * catchUp;
      body.z += (pose.z - body.z) * catchUp;
      body.yaw += shortestAngle(body.yaw, pose.yaw) * catchUp;
      body.sit += ((pose.seat >= 0 ? 1 : 0) - body.sit) * k;
      const seat = pose.seat >= 0 ? seatAt(pose.seat) : null;
      if (seat) body.seatY = seat.y;

      if (body.act) {
        body.act.age += dt;
        if (body.act.age >= body.act.delay + body.act.sec) body.act = null;
      }

      const travelled = Math.hypot(body.x - wasX, body.z - wasZ);
      const speed = dt > 0 ? travelled / dt : 0;
      body.phase += travelled * CROWD.gaitPerMetre;
      const striding = speed > CROWD.walking && body.sit < 0.5 ? 1 : 0;
      body.walk += (striding - body.walk) * k;

      body.root.position.set(body.x, 0, body.z);
      body.root.rotation.y = body.yaw;

      this.pose(body);
    }
  }

  private pose(body: Body): void {
    const sit = smoothstep(body.sit);
    const swing = Math.sin(body.phase) * body.walk;

    const act = body.act;
    const acting = this.acting;
    if (act) {
      const since = act.age - act.delay;
      gestureFrame(
        act.kind,
        act.role,
        since <= 0 ? 0 : since / act.sec,
        acting,
        act.aim,
      );
    } else {
      clearGestureFrame(acting);
    }

    body.lean.rotation.x = -acting.lean;
    body.root.rotation.y = body.yaw + acting.yaw;

    const rise = Math.abs(Math.sin(body.phase)) * CROWD.gaitRise * body.walk;
    body.frame.position.y = lerp(
      body.y + rise,
      body.seatY - BODY.hipY,
      sit,
    );

    for (const side of [0, 1] as const) {
      const lead = side === 0 ? swing : -swing;
      body.legs[side].rotation.x =
        lerp(lead * CROWD.legSwing, SIT.leg, sit) + acting.legX[side];
      body.arms[side].rotation.x =
        lerp(-lead * CROWD.armSwing, SIT.arm, sit) + acting.armX[side];
      body.arms[side].rotation.z = acting.armZ[side];
    }

    const stature = 1 - 0.42 * sit;
    body.hitbox.scale.y = stature;
    body.hitbox.position.y = (BODY_HEIGHT / 2) * stature;
  }

  private build(member: CrowdMember): Body {
    const root = new THREE.Group();
    root.visible = false;
    this.root.add(root);

    const frame = new THREE.Group();
    root.add(frame);

    const lean = new THREE.Group();
    lean.position.y = BODY.hipY;
    frame.add(lean);

    const hue = avatarHue(member.id);
    const shirt = new THREE.MeshStandardMaterial({
      roughness: 0.88,
      metalness: 0,
    });

    const torso = new THREE.Mesh(this.torsoGeo, shirt);
    torso.position.y = BODY.torsoY - BODY.hipY;
    lean.add(torso);

    const head = new THREE.Mesh(this.headGeo, this.headMaterials);
    head.position.y = BODY.headY - BODY.hipY;
    lean.add(head);

    const legs: THREE.Group[] = [];
    const arms: THREE.Group[] = [];

    for (const side of [0, 1]) {
      const sign = side === 0 ? -1 : 1;

      const hip = new THREE.Group();
      hip.position.set(sign * BODY.hipX, BODY.hipY, 0);
      hip.add(new THREE.Mesh(this.legGeo, this.trousers));
      frame.add(hip);
      legs.push(hip);

      const shoulder = new THREE.Group();
      shoulder.position.set(sign * BODY.shoulderX, BODY.shoulderY - BODY.hipY, 0);
      shoulder.add(new THREE.Mesh(this.armGeo, this.skin));
      lean.add(shoulder);
      arms.push(shoulder);
    }

    const hitbox = new THREE.Mesh(this.hitGeo, this.hitMaterial);
    hitbox.position.y = BODY_HEIGHT / 2;
    hitbox.userData.person = member.id;
    frame.add(hitbox);

    const speech = new Bubble();
    frame.add(speech.sprite);
    const spark = new Bubble();
    frame.add(spark.sprite);

    const tagTexture = nameTexture(member.name, !member.present);
    const tagMaterial = new THREE.SpriteMaterial({
      map: tagTexture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const tag = new THREE.Sprite(tagMaterial);
    tag.position.y = CROWD.tagY;
    tag.renderOrder = 10;
    frame.add(tag);

    const body: Body = {
      id: member.id,
      name: member.name,
      present: member.present,
      root,
      frame,
      lean,
      legs: [legs[0]!, legs[1]!],
      arms: [arms[0]!, arms[1]!],
      hitbox,
      speech,
      said: null,
      spark,
      act: null,
      tag,
      tagMaterial,
      tagTexture,
      shirt,
      hue,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      sit: 0,
      seatY: COUCH.seatY,
      walk: 0,
      phase: 0,
      placed: false,
      snap: false,
    };

    this.fitTag(body);
    this.applyPresence(body);
    return body;
  }

  private retag(body: Body): void {
    body.tagTexture.dispose();
    body.tagTexture = nameTexture(body.name, !body.present);
    body.tagMaterial.map = body.tagTexture;
    body.tagMaterial.needsUpdate = true;
    this.fitTag(body);
  }

  private fitTag(body: Body): void {
    const image = body.tagTexture.image as { width: number; height: number };
    const aspect = image.width / image.height;
    body.tag.scale.set(CROWD.tagHeight * aspect, CROWD.tagHeight, 1);
  }

  private applyPresence(body: Body): void {
    const tone = body.present ? CROWD.shirt : CROWD.idle;
    body.shirt.color.setHSL(body.hue / 360, tone.saturation, tone.lightness);
    body.tagMaterial.opacity = body.present ? 1 : CROWD.idleTagOpacity;
  }

  private destroy(body: Body): void {
    this.root.remove(body.root);
    body.tagTexture.dispose();
    body.tagMaterial.dispose();
    body.shirt.dispose();
    body.speech.dispose();
    body.spark.dispose();
  }

  dispose(): void {
    for (const body of this.bodies.values()) this.destroy(body);
    this.bodies.clear();
    this.torsoGeo.dispose();
    this.headGeo.dispose();
    this.armGeo.dispose();
    this.legGeo.dispose();
    this.hitGeo.dispose();
    this.hitMaterial.dispose();
    this.skin.dispose();
    this.trousers.dispose();
    this.faceMaterial.dispose();
    this.faceMap.dispose();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
