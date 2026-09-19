"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { selection } from "@/lib/haptics";
import { ROOM_GESTURES, ROOM_REACTIONS } from "@/lib/room-protocol";
import type { Unread } from "@/lib/room-store";

import type { Cooldowns } from "./lib/gestures";
import type { Input } from "./lib/input";
import { MOVE } from "./lib/tuning";
import { REACTION_BUTTON } from "./reaction-button";
import type { AimedPerson, AimTarget } from "./scene/lounge-canvas";

function promptFor(
  aim: AimTarget,
  seated: boolean,
  switchOn: boolean | null,
): string | null {
  if (aim === "person") return null;
  if (aim === "screen") return "Watch fullscreen";
  if (aim === "switch") {
    return switchOn ? "Turn this light off" : "Turn this light on";
  }
  if (aim === "seat") return "Sit down";
  if (aim === "button") return "Press";
  return seated ? "Stand up" : null;
}

function refusalFor(aim: AimTarget): string | null {
  if (aim === "screen-far") return "Walk closer to watch fullscreen";
  if (aim === "seat-taken") return "Someone is sitting there";
  return null;
}

const ICON_STROKE = 1.6;

const SOCIAL_STROKE = 1.7;

const SQUIRCLE = "rounded-[25%]";

const TOUCH_BUTTON = `pointer-events-auto absolute right-6 hidden size-12 touch-none place-items-center ${SQUIRCLE} bg-white/12 text-white/85 backdrop-blur-md active:bg-white/25 [@media(pointer:coarse)]:grid`;

const BUTTON_STACK = ["4.5rem", "8rem", "11.5rem"] as const;

const CONTROL_GAP = 8;

const CONTROL_SIZE = 48;

const ACTION_EDGE = 24 + CONTROL_SIZE;

const SOCIAL_RIGHT = ACTION_EDGE + CONTROL_GAP;

const SOCIAL_EDGE = SOCIAL_RIGHT + CONTROL_SIZE;

const SOCIAL_BUTTON = `pointer-events-auto absolute grid size-12 touch-none place-items-center ${SQUIRCLE} bg-white/12 text-white/85 backdrop-blur-md active:bg-white/25`;

const HINT_TOP = "absolute inset-x-0 top-[calc(50%+1.125rem)]";

const TRAY_ITEM = 44;

const TRAY_HEADROOM = 64;

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={SOCIAL_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </svg>
  );
}

const CHEVRON = {
  up: "m18 15-6-6-6 6",
  down: "m6 9 6 6 6-6",
  left: "m15 18-6-6 6-6",
  right: "m9 18 6-6-6-6",
} as const;

function ChevronIcon({
  direction,
  flipped,
}: {
  direction: keyof typeof CHEVRON;
  flipped?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={SOCIAL_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-6 transition-transform duration-200 ease-out ${
        flipped ? "rotate-180" : "rotate-0"
      }`}
    >
      <path d={CHEVRON[direction]} />
    </svg>
  );
}

const GESTURE_FACE: Record<(typeof ROOM_GESTURES)[number], string> = {
  slap: "🤚",
  kiss: "😘",
  hug: "🤗",
  kick: "🦵",
};

function useClock(until: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const beat = Date.now();
      setNow(beat);
      if (beat >= until) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [until]);

  return now;
}

function GesturePicker({
  person,
  cooldowns,
}: {
  person: AimedPerson;
  cooldowns: Cooldowns;
}) {
  const until = Math.max(...ROOM_GESTURES.map((kind) => cooldowns[kind]));
  const now = useClock(until);

  return (
    <div className={`${HINT_TOP} flex flex-col items-center gap-2`}>
      <span className="max-w-[60vw] truncate rounded-[10px] bg-black/55 px-3.5 py-2 text-[15px] font-medium tracking-wide text-white/85 backdrop-blur-sm">
        {person.name}
      </span>
      <div className="pointer-events-auto flex items-start gap-2">
        {ROOM_GESTURES.map((kind, index) => {
          const left = Math.max(0, Math.ceil((cooldowns[kind] - now) / 1000));
          const locked = left > 0;
          return (
            <button
              key={kind}
              type="button"
              data-room-gesture={locked ? undefined : kind}
              aria-label={locked ? `${kind} ready in ${left}s` : kind}
              aria-disabled={locked || undefined}
              className={`flex min-w-14 touch-none flex-col items-center gap-2.5 rounded-xl px-3.5 py-2.5 backdrop-blur-sm ${
                locked
                  ? "bg-black/40 opacity-55"
                  : "bg-black/55 active:bg-black/75"
              }`}
            >
              <span className="text-[19px] leading-none">
                {GESTURE_FACE[kind]}
              </span>
              <span className="text-[11px] leading-none font-medium tracking-wide whitespace-nowrap text-white/75 uppercase">
                {locked ? (
                  <span className="font-mono">{left}s</span>
                ) : (
                  <>
                    <span className="[@media(pointer:coarse)]:hidden">
                      {index + 1}
                    </span>
                    <span className="hidden [@media(pointer:coarse)]:inline">
                      {kind}
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReactionTray({ onReact }: { onReact: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [flat, setFlat] = useState(false);
  const chevronRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const decide = () => {
      const button = chevronRef.current;
      if (!button) return;
      const column =
        ROOM_REACTIONS.length * TRAY_ITEM +
        (ROOM_REACTIONS.length - 1) * CONTROL_GAP;
      const room =
        button.getBoundingClientRect().top - CONTROL_GAP - TRAY_HEADROOM;
      setFlat(room < column);
    };

    decide();
    window.addEventListener("resize", decide);
    window.visualViewport?.addEventListener("resize", decide);
    return () => {
      window.removeEventListener("resize", decide);
      window.visualViewport?.removeEventListener("resize", decide);
    };
  }, []);

  return (
    <>
      <div
        className={`absolute flex items-center gap-2 ${
          flat ? "flex-row-reverse flex-wrap-reverse justify-start" : "flex-col-reverse"
        } ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        style={
          flat
            ? {
                right: SOCIAL_EDGE + CONTROL_GAP,
                bottom: `calc(env(safe-area-inset-bottom) + ${BUTTON_STACK[1]} + ${
                  (CONTROL_SIZE - TRAY_ITEM) / 2
                }px)`,
                maxWidth: `calc(100vw - ${SOCIAL_EDGE + CONTROL_GAP * 2}px)`,
              }
            : {
                right: SOCIAL_RIGHT,
                bottom: `calc(env(safe-area-inset-bottom) + ${BUTTON_STACK[1]} + ${
                  (CONTROL_SIZE + CONTROL_GAP) / 16
                }rem)`,
              }
        }
      >
        {ROOM_REACTIONS.map((emoji, index) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React ${emoji}`}
            onClick={() => {
              setOpen(false);
              onReact(emoji);
            }}
            className={`${REACTION_BUTTON} size-11 touch-none transition-all duration-200 ease-out ${
              open
                ? "translate-x-0 translate-y-0 scale-100 opacity-100"
                : `pointer-events-none scale-75 opacity-0 ${
                    flat ? "translate-x-4" : "translate-y-4"
                  }`
            }`}
            style={{
              transitionDelay: `${(open ? index : ROOM_REACTIONS.length - 1 - index) * 30}ms`,
            }}
          >
            {emoji}
          </button>
        ))}
      </div>

      <button
        ref={chevronRef}
        type="button"
        aria-label={open ? "Close reactions" : "React"}
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
          selection();
        }}
        className={SOCIAL_BUTTON}
        style={{
          right: SOCIAL_RIGHT,
          bottom: `calc(env(safe-area-inset-bottom) + ${BUTTON_STACK[1]})`,
        }}
      >
        <ChevronIcon direction={flat ? "left" : "up"} flipped={open} />
      </button>
    </>
  );
}

function WatchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <rect x="2.5" y="4.5" width="19" height="12.5" rx="2" />
      <path d="M9 20.5h6" />
    </svg>
  );
}

function LightIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <path d="M9 17.5a6 6 0 1 1 6 0v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19z" />
      <path d="M10 20.5h4" />
      {on ? (
        <g className="opacity-70">
          <path d="M12 1.5v1.5M4.4 4.4l1 1M19.6 4.4l-1 1M2 12h1.5M20.5 12H22" />
        </g>
      ) : null}
    </svg>
  );
}

function SeatIcon({ standing }: { standing: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <path d="M6 5v7h12" />
      <path d="M4.5 12h15a1.5 1.5 0 0 1 1.5 1.5V17H3v-3.5A1.5 1.5 0 0 1 4.5 12Z" />
      <path d="M5 17v2.5M19 17v2.5" />
      {standing ? (
        <path d="M14.5 9.5 17 7l2.5 2.5M17 7v5" className="opacity-70" />
      ) : (
        <path d="M14.5 5.5 17 8l2.5-2.5M17 8V3" className="opacity-70" />
      )}
    </svg>
  );
}

function PressIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      className="size-6"
    >
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" className="opacity-70" />
    </svg>
  );
}

function ActionIcon({
  aim,
  seated,
  switchOn,
}: {
  aim: AimTarget;
  seated: boolean;
  switchOn: boolean | null;
}) {
  if (aim === "screen") return <WatchIcon />;
  if (aim === "switch") return <LightIcon on={Boolean(switchOn)} />;
  if (aim === "button") return <PressIcon />;
  if (aim === "seat") return <SeatIcon standing={false} />;
  return <SeatIcon standing={seated} />;
}

function TouchStick({ inputRef }: { inputRef: RefObject<Input | null> }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let running = false;

    const draw = () => {
      const stick = inputRef.current?.stick;
      const wrap = wrapRef.current;
      const base = baseRef.current;
      const knob = knobRef.current;
      if (!wrap || !base || !knob) {
        running = false;
        return;
      }

      if (!stick?.active) {
        wrap.style.opacity = "0";
        running = false;
        return;
      }

      const dx = stick.x - stick.originX;
      const dy = stick.y - stick.originY;
      const dist = Math.hypot(dx, dy);
      const scale = dist > MOVE.stickRadius ? MOVE.stickRadius / dist : 1;

      wrap.style.opacity = "1";
      base.style.transform = `translate3d(${stick.originX}px, ${stick.originY}px, 0) translate(-50%, -50%)`;
      knob.style.transform = `translate3d(${stick.originX + dx * scale}px, ${
        stick.originY + dy * scale
      }px, 0) translate(-50%, -50%)`;

      frame = requestAnimationFrame(draw);
    };

    const wake = () => {
      if (running) return;
      running = true;
      frame = requestAnimationFrame(draw);
    };

    window.addEventListener("pointerdown", wake, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", wake, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [inputRef]);

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none fixed inset-0 hidden transition-opacity duration-200 ease-out [@media(pointer:coarse)]:block"
      style={{ opacity: 0 }}
    >
      <div
        ref={baseRef}
        className="absolute top-0 left-0 rounded-full bg-white/8 backdrop-blur-[2px]"
        style={{
          width: MOVE.stickRadius * 2,
          height: MOVE.stickRadius * 2,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        }}
      />
      <div
        ref={knobRef}
        className="absolute top-0 left-0 size-14 rounded-full bg-white/25 backdrop-blur-sm"
        style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }}
      />
    </div>
  );
}

export function LoungeHud({
  aim,
  person,
  seated,
  switchOn,
  unread,
  cooldowns,
  inputRef,
  onOpenChat,
  onReact,
}: {
  aim: AimTarget;
  person: AimedPerson | null;
  seated: boolean;
  switchOn: boolean | null;
  unread: Unread;
  cooldowns: Cooldowns;
  inputRef: RefObject<Input | null>;
  onOpenChat: () => void;
  onReact: (emoji: string) => void;
}) {
  const prompt = promptFor(aim, seated, switchOn);
  const refusal = refusalFor(aim);
  const needsStand = seated && aim === "screen";
  const missed = unread.text + unread.emoji > 0;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-black/40 transition-all duration-150 ease-out ${
          prompt ? "size-3 bg-white/90" : "size-1.5 bg-white/70"
        }`}
      />

      {aim === "person" && person ? (
        <GesturePicker person={person} cooldowns={cooldowns} />
      ) : null}

      {prompt ? (
        <div className={`${HINT_TOP} flex flex-col items-center`}>
          <span className="rounded-lg bg-black/55 px-2.5 py-1.5 text-[12px] font-medium tracking-wide text-white/85 backdrop-blur-sm">
            <span className="[@media(pointer:coarse)]:hidden">
              Click or press E to {prompt.toLowerCase()}
            </span>
            <span className="hidden [@media(pointer:coarse)]:inline">
              {prompt}
            </span>
          </span>
          {needsStand ? (
            <span className="mt-1 rounded-lg bg-black/40 px-2 py-1 text-[11px] tracking-wide text-white/50 backdrop-blur-sm [@media(pointer:coarse)]:hidden">
              Q to stand up
            </span>
          ) : null}
        </div>
      ) : refusal ? (
        <div className={`${HINT_TOP} flex justify-center`}>
          <span className="rounded-lg bg-black/35 px-2.5 py-1.5 text-[12px] tracking-wide text-white/50 backdrop-blur-sm">
            {refusal}
          </span>
        </div>
      ) : null}

      <div
        className="absolute inset-x-0 flex justify-center gap-2 text-[11px] tracking-wider text-white/45 [@media(pointer:coarse)]:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + var(--hud-inset))" }}
      >
        <span className="rounded-lg bg-white/8 px-2.5 py-1.5 backdrop-blur-sm">
          WASD to move
        </span>
        <span className="rounded-lg bg-white/8 px-2.5 py-1.5 backdrop-blur-sm">
          Drag to look
        </span>
        <span className="rounded-lg bg-white/8 px-2.5 py-1.5 backdrop-blur-sm">
          Space to jump
        </span>
        <span className="rounded-lg bg-white/8 px-2.5 py-1.5 backdrop-blur-sm">
          Enter to chat
        </span>
      </div>

      <TouchStick inputRef={inputRef} />

      <button
        type="button"
        aria-label={missed ? "Open chat, unread" : "Open chat"}
        onClick={onOpenChat}
        className={SOCIAL_BUTTON}
        style={{
          right: SOCIAL_RIGHT,
          bottom: `calc(env(safe-area-inset-bottom) + ${BUTTON_STACK[0]})`,
        }}
      >
        <ChatIcon />
        {missed ? (
          <span className="absolute top-[7px] right-[7px] size-2.5 rounded-full bg-destructive ring-2 ring-black/35" />
        ) : null}
      </button>

      <ReactionTray onReact={onReact} />

      <button
        type="button"
        data-room-jump
        className={`${TOUCH_BUTTON} text-[10px] font-semibold tracking-[0.08em] uppercase`}
        style={{
          bottom: `calc(env(safe-area-inset-bottom) + ${BUTTON_STACK[0]})`,
        }}
      >
        Jump
      </button>

      {prompt ? (
        <button
          type="button"
          data-room-interact
          aria-label={prompt}
          className={TOUCH_BUTTON}
          style={{
            bottom: `calc(env(safe-area-inset-bottom) + ${BUTTON_STACK[1]})`,
          }}
        >
          <ActionIcon aim={aim} seated={seated} switchOn={switchOn} />
        </button>
      ) : null}

      {needsStand ? (
        <button
          type="button"
          data-room-stand
          aria-label="Stand up"
          className={TOUCH_BUTTON}
          style={{
            bottom: `calc(env(safe-area-inset-bottom) + ${BUTTON_STACK[2]})`,
          }}
        >
          <SeatIcon standing />
        </button>
      ) : null}
    </div>
  );
}
