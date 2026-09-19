"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from "react";

import { avatarHue, initial } from "@/lib/avatar";
import { impact } from "@/lib/haptics";
import {
  CHAT_TEXT_MAX,
  ROOM_REACTIONS,
  withRoomToken,
} from "@/lib/room-protocol";
import type { RoomChatMessage } from "@/lib/room-protocol";

import { BottomSheet } from "../player/bottom-sheet";
import { DeckPager } from "../player/deck-pager";
import { useRoom, useRoomStore } from "../player/live-provider";
import { SheetTabs, pillTransform } from "../player/sheet-tabs";
import type { Input } from "./lib/input";
import { REACTION_BUTTON } from "./reaction-button";

const TABS = ["Chats", "Reactions"];

const PAGER_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const SHOWN = 25;

const ROW_WINDOW =
  "[content-visibility:auto] [contain-intrinsic-size:auto_60px]";

function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const measure = () => {
      const covered =
        window.innerHeight - (viewport.height + viewport.offsetTop);
      setInset(covered > 1 ? Math.round(covered) : 0);
    };

    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, []);

  return inset;
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

function usePinnedToLatest(latest: string | undefined): RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [latest]);
  return ref;
}

function Face({
  id,
  name,
  avatarUrl,
}: {
  id: string;
  name: string;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={44}
        height={44}
        className="size-11 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      style={{ "--avatar-hue": avatarHue(id + name) } as CSSProperties}
      className="bg-avatar-tint flex size-11 shrink-0 items-center justify-center rounded-full font-display text-[21px] font-medium text-[oklch(97%_0.02_var(--avatar-hue))]"
    >
      {initial(name)}
    </span>
  );
}

function ChatLog({
  messages,
  avatars,
}: {
  messages: RoomChatMessage[];
  avatars: Map<string, string | null>;
}) {
  const pin = usePinnedToLatest(messages[messages.length - 1]?.id);

  return (
    <section ref={pin}>
      {messages.length === 0 ? (
        <p className="px-2 py-4 text-center text-[15px] text-muted-foreground">
          Nobody has said anything yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`flex items-start gap-3 rounded-xl px-2 py-2 ${ROW_WINDOW}`}
            >
              <Face
                id={message.from}
                name={message.name}
                avatarUrl={avatars.get(message.from)}
              />

              <span className="flex min-w-0 flex-1 flex-col gap-[3.2px]">
                <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] leading-[1.35] font-normal text-muted-foreground">
                  <span className="truncate">{message.name}</span>
                  <span className="shrink-0 font-mono text-[11.5px]">
                    {clock(message.at)}
                  </span>
                </span>

                <span className="text-[15.8px] leading-[1.32] font-[480] tracking-[-0.1px] break-words">
                  {message.text}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReactionLog({ messages }: { messages: RoomChatMessage[] }) {
  const pin = usePinnedToLatest(messages[messages.length - 1]?.id);

  return (
    <section ref={pin}>
      {messages.length === 0 ? (
        <p className="px-2 py-4 text-center text-[15px] text-muted-foreground">
          No reactions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`flex items-center gap-3 rounded-xl px-2 py-2 ${ROW_WINDOW}`}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-[22px] leading-none">
                {message.text}
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-[3.2px]">
                <span className="truncate text-[15.8px] leading-[1.32] font-[480] tracking-[-0.1px]">
                  {message.name}
                </span>
                <span className="font-mono text-[13px] leading-[1.35] font-normal text-muted-foreground">
                  {clock(message.at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ChatSheet({
  token,
  onClose,
  inputRef,
}: {
  token: string;
  onClose: () => void;
  inputRef: RefObject<Input | null>;
}) {
  const store = useRoomStore();
  const chat = useRoom((state) => state.chat);
  const participants = useRoom((state) => state.snapshot?.participants);
  const unread = useRoom((state) => state.unread);

  const [tab, setTab] = useState(0);
  const [draft, setDraft] = useState("");
  const fieldRef = useRef<HTMLInputElement>(null);
  const lift = useKeyboardInset();

  const pillRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef(-1);

  useEffect(() => {
    const input = inputRef.current;
    input?.setTyping(true);
    return () => input?.setTyping(false);
  }, [inputRef]);

  useEffect(() => {
    store.setReading(tab === 1 ? "emoji" : "text");
    return () => store.setReading(null);
  }, [store, tab]);

  const onProgress = useCallback((progress: number, ms: number) => {
    const pill = pillRef.current;
    if (pill) {
      pill.style.transition = ms ? `transform ${ms}ms ${PAGER_EASE}` : "none";
      pill.style.transform = pillTransform(progress);
    }

    const next = Math.round(progress);
    if (next === focusRef.current) return;
    focusRef.current = next;
    barRef.current
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      .forEach((element, tabIndex) =>
        element.toggleAttribute("data-active", tabIndex === next),
      );
  }, []);

  const said = useMemo(
    () => chat.filter((message) => message.kind === "text").slice(-SHOWN),
    [chat],
  );
  const reacted = useMemo(
    () => chat.filter((message) => message.kind === "emoji").slice(-SHOWN),
    [chat],
  );

  const avatars = useMemo(() => {
    const found = new Map<string, string | null>();
    for (const person of participants ?? []) {
      found.set(person.id, withRoomToken(person.photoUrl, token));
    }
    return found;
  }, [participants, token]);

  const panes = useMemo(
    () => [
      <ChatLog key="chats" messages={said} avatars={avatars} />,
      <ReactionLog key="reactions" messages={reacted} />,
    ],
    [said, reacted, avatars],
  );

  const send = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    store.say(text);
    setDraft("");
    impact("light");
    fieldRef.current?.focus();
    setTab(0);
  };

  return (
    <BottomSheet
      title={TABS[tab] ?? "Chats"}
      scroll={false}
      lift={lift}
      onClose={onClose}
      header={
        <SheetTabs
          labels={TABS}
          active={tab}
          badges={[unread.text > 0, unread.emoji > 0]}
          barRef={barRef}
          pillRef={pillRef}
          onChange={setTab}
        />
      }
    >
      <DeckPager
        index={tab}
        onIndexChange={setTab}
        onProgress={onProgress}
        panes={panes}
      />

      {/*
        The composer, which is whichever tab you are on.

        Not two rows with one hidden: the row under a list of reactions is for
        sending reactions, and a text field sitting there greyed out would be
        offering the wrong thing in the one place the right thing belongs. What
        stays constant is the space it occupies - same padding, same 48 px of
        height - so switching tabs does not resize the sheet under your thumb.

        48 px because that is the tab bar's height at the top of the sheet. The
        sheet's two rounded rows are the first and last things in it and read as
        a pair, so a composer a few pixels shorter than the tabs looked like the
        tabs had been given the weight rather than like a size chosen for either.

        Part of the body rather than a footer under it. The sheet supplies the
        bottom padding and the panes' own `px-2.5` is matched here, so this lines
        up with the messages above it instead of sitting in a band of its own.
      */}
      {tab === 1 ? (
        /*
          A scrolling row, not a fitted one.

          Six spread across the width was a row that had to be exactly six -
          every one added past that either shrank the buttons below the size of
          a thumb or wrapped into a second line and moved the composer's height,
          which is the one thing the tab switch must not do. Scrolling makes the
          count somebody else's problem: the list can grow to whatever it grows
          to and this stays one row of 48 px targets.

          `touch-pan-x` so a sideways drag scrolls the strip rather than being
          read as a swipe by anything above it, and `overscroll-x-contain` so
          reaching the end does not hand the gesture on to the pager behind it.
          The buttons carry the same `touch-pan-x`: the strip is nearly all
          button, so whether a drag scrolls has to not depend on landing in the
          gaps between them.
        */
        <div className="no-scrollbar flex shrink-0 touch-pan-x items-center gap-2 overflow-x-auto overscroll-x-contain px-2.5 pt-2">
          {ROOM_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => {
                store.react(emoji);
                impact("light");
              }}
              className={`${REACTION_BUTTON} size-12 touch-pan-x`}
            >
              {emoji}
            </button>
          ))}
          {/*
            The row's own trailing edge.

            A scroll container's `padding-right` is ignored by some engines once
            the content overflows, so the last emoji ends flush against the
            screen and looks clipped. A zero-height spacer is padding those
            engines cannot skip.
          */}
          <span aria-hidden className="w-0.5 shrink-0" />
        </div>
      ) : (
        <form
          onSubmit={send}
          className="flex shrink-0 items-center gap-2 px-2.5 pt-2"
        >
          <input
            ref={fieldRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={CHAT_TEXT_MAX}
            placeholder="Say something"
            /*
              A height rather than padding, so it is exactly the button's.

              The two were 41 and 44 - near enough to look like a mistake rather
              than a choice, which is what a two-element row is least forgiving
              of: they sit side by side with nothing between them to hide it.
              Both are `h-12` now and cannot drift, because neither is being
              derived from a font size any more. The reaction row above matches
              it too, for the same reason at a larger scale: the composer must
              not change height when the tab does.
            */
            className="h-12 min-w-0 flex-1 rounded-full bg-secondary px-4 text-[15.5px] text-foreground placeholder:text-muted-foreground focus:outline-none [-webkit-user-select:text] select-text"
            enterKeyHint="send"
            autoComplete="off"
            autoCapitalize="sentences"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground transition-[opacity,background-color] disabled:opacity-40 active:bg-primary-active"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[20px]"
            >
              <path d="M4.5 12h13M12 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      )}

    </BottomSheet>
  );
}
