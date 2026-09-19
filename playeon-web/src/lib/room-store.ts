import {
  CHAT_LOG_MAX,
  CLOSE_JOINED_ELSEWHERE,
  livePositionSec,
  POSE_TICK_MS,
  type ClientMessage,
  type RoomChatMessage,
  type RoomControlAction,
  type RoomEvent,
  type RoomGesture,
  type RoomGestureKind,
  type RoomParticipant,
  type RoomPose,
  type RoomSnapshot,
  type ServerMessage,
} from "./room-protocol";

export type RoomStatus = "connecting" | "open" | "reconnecting" | "closed";

export type ChatKind = RoomChatMessage["kind"];

export type Unread = { text: number; emoji: number };

export type Sighting = {
  id: string;
  from: string;
  kind: ChatKind;
  at: number;
};

export type RoomState = {
  status: RoomStatus;
  snapshot: RoomSnapshot | null;
  self: RoomParticipant | null;
  clockOffsetMs: number;
  error: string | null;
  event: (RoomEvent & { seq: number }) | null;
  chat: RoomChatMessage[];
  unread: Unread;
};

export type Bubble = {
  id: string;
  kind: RoomChatMessage["kind"];
  text: string;
  at: number;
};

export type RemotePose = RoomPose & {
  id: string;
  at: number;
};

const POSE_EPSILON_M = 0.02;
const POSE_EPSILON_RAD = 0.02;

const PING_INTERVAL_MS = 25_000;
const OUTBOX_TTL_MS = 5000;
const FIRST_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

const GESTURE_QUEUE_MAX = 8;

const SIGHTING_QUEUE_MAX = 64;

const NOTHING_UNREAD: Unread = { text: 0, emoji: 0 };

const INITIAL: RoomState = {
  status: "connecting",
  snapshot: null,
  self: null,
  clockOffsetMs: 0,
  error: null,
  event: null,
  chat: [],
  unread: NOTHING_UNREAD,
};

export function closeMiniApp(): void {
  try {
    window.Telegram?.WebApp?.close?.();
  } catch {
  }
}

const EMPTY_GESTURES: RoomGesture[] = [];

function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export class RoomStore {
  #state: RoomState = INITIAL;
  #listeners = new Set<() => void>();

  #socket: WebSocket | null = null;
  #url: string;
  #token: string;

  #rev = 0;
  #backoff = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #eventSeq = 0;
  #outbox: { message: ClientMessage; at: number }[] = [];
  #notifyScheduled = false;
  #stopped = false;
  #present = true;

  #poses = new Map<string, RemotePose>();
  #lights: boolean[] = [];
  #lightsRev = 0;
  #anomalyRev = 0;
  #bubbles = new Map<string, Bubble>();
  #gestures: RoomGesture[] = [];
  #sightings: Sighting[] = [];
  #reading: ChatKind | null = null;
  #posesSeen = new Set<string>();
  #pose: RoomPose | null = null;
  #poseSentAt = 0;

  constructor(base: string, token: string) {
    this.#url = base.replace(/\/+$/, "").replace(/^http/, "ws");
    this.#token = token;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getState = (): RoomState => this.#state;

  #set(patch: Partial<RoomState>): void {
    this.#state = { ...this.#state, ...patch };

    if (this.#notifyScheduled) return;
    this.#notifyScheduled = true;
    queueMicrotask(() => {
      this.#notifyScheduled = false;
      for (const listener of this.#listeners) listener();
    });
  }

  positionSec(): number {
    return livePositionSec(this.#state.snapshot, this.#state.clockOffsetMs);
  }

  start(): void {
    this.#stopped = false;
    const state = this.#socket?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    this.#backoff = 0;
    this.#connect();
  }

  #connect(): void {
    if (this.#stopped) return;
    this.#rev = 0;

    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `${this.#url}/room?token=${encodeURIComponent(this.#token)}`,
      );
    } catch {
      this.#scheduleReconnect();
      return;
    }

    this.#socket = socket;
    this.#set({ status: this.#backoff === 0 ? "connecting" : "reconnecting" });

    socket.onopen = () => {
      this.#backoff = 0;
      this.#set({ status: "open", error: null });
      this.send({ type: "presence", present: this.#present });
      if (this.#pose) this.send({ type: "pose", pose: this.#pose });
      this.#flushOutbox();
      this.#pingTimer = setInterval(
        () => this.send({ type: "ping" }),
        PING_INTERVAL_MS,
      );
    };

    socket.onmessage = (raw) => this.#receive(raw.data);

    socket.onclose = (closed) => {
      this.#clearPing();
      if (closed.code === CLOSE_JOINED_ELSEWHERE) {
        this.#stopped = true;
        this.#set({ status: "closed" });
        closeMiniApp();
        return;
      }
      if (!this.#stopped) this.#scheduleReconnect();
    };

    socket.onerror = () => {
      try {
        socket.close();
      } catch {
      }
    };
  }

  #receive(data: unknown): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }

    switch (message.type) {
      case "welcome":
        this.#set({ self: message.self });
        return;

      case "snapshot":
        if (message.rev < this.#rev) return;
        this.#rev = message.rev;
        this.#applyLights(message.lights ?? []);
        this.#set({
          snapshot: message,
          clockOffsetMs: message.serverTime - Date.now(),
        });
        return;

      case "lights":
        this.#applyLights(message.lights);
        return;

      case "anomaly":
        this.#anomalyRev += 1;
        return;

      case "poses": {
        const selfId = this.#state.self?.id;
        const at = Date.now();
        const seen = this.#posesSeen;
        seen.clear();

        for (const pose of message.poses) {
          if (typeof pose?.id !== "string" || pose.id === selfId) continue;
          seen.add(pose.id);
          const known = this.#poses.get(pose.id);
          if (known) {
            known.x = pose.x;
            known.y = pose.y;
            known.z = pose.z;
            known.yaw = pose.yaw;
            known.seat = pose.seat;
            known.at = at;
          } else {
            this.#poses.set(pose.id, { ...pose, at });
          }
        }
        for (const id of this.#poses.keys()) {
          if (!seen.has(id)) this.#poses.delete(id);
        }
        return;
      }

      case "chat": {
        const said = message.message;
        const at = Date.now();
        this.#bubbles.set(said.from, {
          id: said.id,
          kind: said.kind,
          text: said.text,
          at,
        });
        const chat = [...this.#state.chat, said];
        this.#set({
          chat:
            chat.length > CHAT_LOG_MAX
              ? chat.slice(chat.length - CHAT_LOG_MAX)
              : chat,
        });
        this.#expect({ id: said.id, from: said.from, kind: said.kind, at });
        return;
      }

      case "chatlog":
        this.#set({ chat: message.messages.slice(-CHAT_LOG_MAX) });
        return;

      case "gesture":
        this.#gestures.push(message);
        if (this.#gestures.length > GESTURE_QUEUE_MAX) {
          this.#gestures.splice(0, this.#gestures.length - GESTURE_QUEUE_MAX);
        }
        return;

      case "event":
        this.#eventSeq += 1;
        this.#set({ event: { ...message, seq: this.#eventSeq } });
        return;

      case "error":
        this.#set({ error: message.message });
        return;

      case "closed":
        this.#stopped = true;
        this.#clearTimers();
        try {
          this.#socket?.close();
        } catch {
        }
        this.#set({ status: "closed" });
        closeMiniApp();
        return;
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#set({ status: "reconnecting" });
    this.#backoff = Math.min(
      MAX_BACKOFF_MS,
      this.#backoff === 0 ? FIRST_BACKOFF_MS : this.#backoff * 2,
    );
    this.#reconnectTimer = setTimeout(() => this.#connect(), this.#backoff);
  }

  #clearPing(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  #clearTimers(): void {
    this.#clearPing();
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  send(message: ClientMessage): void {
    const socket = this.#socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    if (message.type === "control") {
      this.#outbox.push({ message, at: Date.now() });
      this.#reviveNow();
    }
  }

  #flushOutbox(): void {
    if (this.#outbox.length === 0) return;
    const now = Date.now();
    const pending = this.#outbox;
    this.#outbox = [];
    for (const { message, at } of pending) {
      if (now - at > OUTBOX_TTL_MS) continue;
      this.send(message);
    }
  }

  #reviveNow(): void {
    if (this.#stopped) return;
    const state = this.#socket?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#backoff = 0;
    this.#connect();
  }

  control(action: RoomControlAction): void {
    this.send({ type: "control", ...action });
  }

  poses(): ReadonlyMap<string, RemotePose> {
    return this.#poses;
  }

  lights(): readonly boolean[] {
    return this.#lights;
  }

  lightsRev(): number {
    return this.#lightsRev;
  }

  anomalyRev(): number {
    return this.#anomalyRev;
  }

  callAnomaly(): void {
    this.send({ type: "anomaly" });
  }

  setLight(index: number, on: boolean): void {
    this.send({ type: "lights", index, on });
  }

  #applyLights(lights: readonly boolean[]): void {
    const same =
      lights.length === this.#lights.length &&
      lights.every((on, index) => on === this.#lights[index]);
    if (same) return;
    this.#lights = [...lights];
    this.#lightsRev += 1;
  }

  publishPose(pose: RoomPose | null, force = false): void {
    if (!pose) {
      if (this.#pose) this.send({ type: "pose", pose: null });
      this.#pose = null;
      return;
    }

    const was = this.#pose;
    const moved =
      !was ||
      was.seat !== pose.seat ||
      Math.abs(was.x - pose.x) > POSE_EPSILON_M ||
      Math.abs(was.y - pose.y) > POSE_EPSILON_M ||
      Math.abs(was.z - pose.z) > POSE_EPSILON_M ||
      Math.abs(angleDelta(was.yaw, pose.yaw)) > POSE_EPSILON_RAD;
    if (!moved && !force) return;

    const now = Date.now();
    if (
      !force &&
      was &&
      was.seat === pose.seat &&
      now - this.#poseSentAt < POSE_TICK_MS
    ) {
      return;
    }

    this.#poseSentAt = now;
    this.#pose = { ...pose };
    this.send({ type: "pose", pose: this.#pose });
  }

  bubbles(): ReadonlyMap<string, Bubble> {
    return this.#bubbles;
  }

  #expect(sighting: Sighting): void {
    if (sighting.from === this.#state.self?.id) return;
    if (sighting.kind === this.#reading) return;

    this.#sightings.push(sighting);
    const spare = this.#sightings.length - SIGHTING_QUEUE_MAX;
    if (spare <= 0) return;
    this.#missed(this.#sightings.splice(0, spare));
  }

  #missed(sightings: readonly Sighting[]): void {
    if (sightings.length === 0) return;
    const unread = { ...this.#state.unread };
    for (const sighting of sightings) unread[sighting.kind] += 1;
    this.#set({ unread });
  }

  sightings(): readonly Sighting[] {
    return this.#sightings;
  }

  settle(id: string, seen: boolean): void {
    const at = this.#sightings.findIndex((sighting) => sighting.id === id);
    if (at < 0) return;
    const [gone] = this.#sightings.splice(at, 1);
    if (seen || !gone) return;
    this.#missed([gone]);
  }

  markRead(kind: ChatKind): void {
    for (let at = this.#sightings.length - 1; at >= 0; at -= 1) {
      if (this.#sightings[at]!.kind === kind) this.#sightings.splice(at, 1);
    }
    if (this.#state.unread[kind] === 0) return;
    const unread = { ...this.#state.unread };
    unread[kind] = 0;
    this.#set({ unread });
  }

  setReading(kind: ChatKind | null): void {
    this.#reading = kind;
    if (kind) this.markRead(kind);
  }

  takeGestures(): RoomGesture[] {
    if (this.#gestures.length === 0) return EMPTY_GESTURES;
    const pending = this.#gestures;
    this.#gestures = [];
    return pending;
  }

  say(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.send({ type: "say", text: trimmed });
  }

  react(emoji: string): void {
    this.send({ type: "react", emoji });
  }

  gesture(kind: RoomGestureKind, targetId: string): void {
    this.send({ type: "gesture", kind, targetId });
  }

  setPresent(present: boolean): void {
    if (present) this.#reviveNow();
    if (present === this.#present) return;
    this.#present = present;
    this.send({ type: "presence", present });
  }

  setRoomName(name: string): void {
    this.send({ type: "setRoomName", name });
  }

  destroy(): void {
    this.#stopped = true;
    this.#clearTimers();
    this.#poses.clear();
    this.#bubbles.clear();
    this.#gestures = [];
    this.#sightings = [];
    this.#reading = null;
    this.#pose = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close();
      } catch {
      }
    }
  }
}
