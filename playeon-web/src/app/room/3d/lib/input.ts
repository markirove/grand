import { ROOM_GESTURES, type RoomGestureKind } from "@/lib/room-protocol";

import { LOOK, MOVE } from "./tuning";

function asGesture(raw: string | undefined): RoomGestureKind | null {
  return ROOM_GESTURES.find((kind) => kind === raw) ?? null;
}

export type Frame = {
  strafe: number;
  forward: number;
  lookYaw: number;
  lookPitch: number;
  jump: boolean;
  interact: boolean;
  stand: boolean;
  gesture: RoomGestureKind | null;
};

export class Input {
  private readonly target: HTMLCanvasElement;
  private readonly keys = new Set<string>();

  private yawDelta = 0;
  private pitchDelta = 0;
  private jumpPressed = false;
  private interactPressed = false;
  private standPressed = false;
  private gesturePressed: RoomGestureKind | null = null;

  private typing = false;

  private stickId: number | null = null;
  private originX = 0;
  private originY = 0;
  private stickX = 0;
  private stickY = 0;

  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private lookTravel = 0;

  private dragId: number | null = null;
  private dragX = 0;
  private dragY = 0;
  private dragTravel = 0;

  constructor(target: HTMLCanvasElement) {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.keys.clear();
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  get stick(): {
    active: boolean;
    originX: number;
    originY: number;
    x: number;
    y: number;
  } {
    return {
      active: this.stickId !== null,
      originX: this.originX,
      originY: this.originY,
      x: this.stickX,
      y: this.stickY,
    };
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
    this.dragId = null;
  }

  setTyping(typing: boolean): void {
    this.typing = typing;
    if (typing) {
      this.keys.clear();
      this.unlock();
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.typing) return;
    const key = event.key.toLowerCase();
    if (key === " " || key.startsWith("arrow")) event.preventDefault();
    if (event.repeat) return;
    this.keys.add(key);
    if (key === " ") this.jumpPressed = true;
    if (key === "e") this.interactPressed = true;
    if (key === "q") this.standPressed = true;
    if (key === "1") this.gesturePressed = "slap";
    if (key === "2") this.gesturePressed = "kiss";
    if (key === "3") this.gesturePressed = "hug";
    if (key === "4") this.gesturePressed = "kick";
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.dragId = null;
  };

  private onPointerDown = (event: PointerEvent): void => {
    const el = event.target as HTMLElement | null;
    if (el?.closest?.("[data-room-jump]")) {
      this.jumpPressed = true;
      return;
    }
    if (el?.closest?.("[data-room-interact]")) {
      this.interactPressed = true;
      return;
    }
    if (el?.closest?.("[data-room-stand]")) {
      this.standPressed = true;
      return;
    }
    const gesture = el?.closest?.("[data-room-gesture]") as HTMLElement | null;
    if (gesture) {
      const kind = asGesture(gesture.dataset.roomGesture);
      if (kind) this.gesturePressed = kind;
      return;
    }
    if (event.target !== this.target) return;

    if (event.pointerType === "mouse") {
      if (this.locked) {
        this.interactPressed = true;
        return;
      }

      this.dragId = event.pointerId;
      this.dragX = event.clientX;
      this.dragY = event.clientY;
      this.dragTravel = 0;
      void Promise.resolve(this.target.requestPointerLock()).catch(() => {});
      return;
    }

    if (event.clientX < window.innerWidth / 2) {
      if (this.stickId !== null) return;
      this.stickId = event.pointerId;
      this.originX = this.stickX = event.clientX;
      this.originY = this.stickY = event.clientY;
    } else {
      if (this.lookId !== null) return;
      this.lookId = event.pointerId;
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      this.lookTravel = 0;
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.dragId) {
      if (!this.locked) {
        const dx = event.clientX - this.dragX;
        const dy = event.clientY - this.dragY;
        this.yawDelta -= dx * LOOK.drag;
        this.pitchDelta -= dy * LOOK.drag;
        this.dragTravel += Math.hypot(dx, dy);
      }
      this.dragX = event.clientX;
      this.dragY = event.clientY;
      return;
    }

    if (event.pointerId === this.stickId) {
      this.stickX = event.clientX;
      this.stickY = event.clientY;

      const dx = this.stickX - this.originX;
      const dy = this.stickY - this.originY;
      const dist = Math.hypot(dx, dy);
      if (dist > MOVE.stickRadius) {
        const pull = dist - MOVE.stickRadius;
        this.originX += (dx / dist) * pull;
        this.originY += (dy / dist) * pull;
      }
      return;
    }

    if (event.pointerId === this.lookId) {
      const dx = event.clientX - this.lookX;
      const dy = event.clientY - this.lookY;
      this.yawDelta -= dx * LOOK.touch;
      this.pitchDelta -= dy * LOOK.touch;
      this.lookTravel += Math.hypot(dx, dy);
      this.lookX = event.clientX;
      this.lookY = event.clientY;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.stickId) this.stickId = null;
    if (event.pointerId === this.lookId) {
      this.lookId = null;
      if (this.lookTravel < MOVE.tapSlop) this.interactPressed = true;
    }
    if (event.pointerId === this.dragId) {
      this.dragId = null;
      if (!this.locked && this.dragTravel < MOVE.clickSlop) {
        this.interactPressed = true;
      }
    }
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.yawDelta -= event.movementX * LOOK.mouse;
    this.pitchDelta -= event.movementY * LOOK.mouse;
  };

  read(): Frame {
    let strafe = 0;
    let forward = 0;

    if (this.keys.has("w") || this.keys.has("arrowup")) forward += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) forward -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) strafe += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) strafe -= 1;

    if (strafe !== 0 || forward !== 0) {
      const len = Math.hypot(strafe, forward);
      strafe /= len;
      forward /= len;
    } else if (this.stickId !== null) {
      const dx = this.stickX - this.originX;
      const dy = this.stickY - this.originY;
      const dist = Math.hypot(dx, dy);
      const mag = Math.min(1, dist / MOVE.stickRadius);
      if (dist > 0 && mag >= MOVE.stickDeadzone) {
        strafe = (dx / dist) * mag;
        forward = (-dy / dist) * mag;
      }
    }

    const frame: Frame = {
      strafe,
      forward,
      lookYaw: this.yawDelta,
      lookPitch: this.pitchDelta,
      jump: this.jumpPressed,
      interact: this.interactPressed,
      stand: this.standPressed,
      gesture: this.gesturePressed,
    };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.jumpPressed = false;
    this.interactPressed = false;
    this.standPressed = false;
    this.gesturePressed = null;
    return frame;
  }
}
