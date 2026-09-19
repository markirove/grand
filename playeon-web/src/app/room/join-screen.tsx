"use client";

import Link from "next/link";

import { siteConfig } from "@/site/config";

import { AvatarBanner } from "./avatar-banner";
import { MarqueeText } from "./marquee-text";
import { RoomShell } from "./room-shell";
import { RoomUnavailable } from "./room-unavailable";
import { withRoomToken } from "@/lib/room-protocol";
import { roomDisplayName } from "@/lib/room-name";
import { roomPath } from "@/lib/room-style";

import { useRoomSession } from "./session-provider";

type Activity = { kind: "video" | "music" | "game"; title: string } | null;

const ACTIVITY_TILE = {
  video: "bg-gradient-video",
  music: "bg-gradient-music",
  game: "bg-gradient-game",
} as const;

const ACTIVITY_ICON_COLOR = {
  video: "text-[oklch(97%_0.020_255)]",
  music: "text-[oklch(97%_0.025_22)]",
  game: "text-[oklch(97%_0.020_155)]",
} as const;

const ACTIVITY_VERB = {
  video: "Watching",
  music: "Listening",
  game: "Playing",
} as const;

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

function participantsLabel(names: string[]) {
  if (names.length <= 1) return names[0] ?? "No one here yet";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

const ICON_CLASS = "size-[27px] shrink-0 text-muted-foreground";

function ActivityIcon({
  kind,
  className = ICON_CLASS,
}: {
  kind: NonNullable<Activity>["kind"];
  className?: string;
}) {
  if (kind === "music") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <circle cx="18" cy="16" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M9 18V9.92707C9 7.74065 9 6.64744 9.6 5.84015C10.2 5.03285 11.24 4.72675 13.32 4.11456C16.84 3.07853 18.6 2.56052 19.8 3.46872C21 4.37693 21 6.22697 21 9.92707V16" />
      </svg>
    );
  }

  if (kind === "game") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={className}
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3.01486 18.0594C3.661 18.6865 4.44018 19 5.35238 19C5.99092 19 6.58385 18.8396 7.13117 18.5188C7.67849 18.1979 8.08898 17.7604 8.36264 17.2063C8.67356 16.6032 8.82901 16.3016 9.05447 16.0785C9.27611 15.8591 9.54597 15.6946 9.84249 15.5982C10.1441 15.5 10.4834 15.5 11.1619 15.5H12.841C13.5004 15.5 13.8301 15.5 14.1236 15.5925C14.4382 15.6917 14.7233 15.8671 14.9537 16.1032C15.1686 16.3234 15.3173 16.6177 15.6146 17.2063C15.8883 17.7604 16.2988 18.1979 16.8461 18.5188C17.3934 18.8396 17.9864 19 18.6249 19C19.5523 19 20.3467 18.6901 21.008 18.0703C21.6694 17.4505 22 16.6958 22 15.8063C22 15.675 21.9886 15.5401 21.9658 15.4016C21.943 15.263 21.9164 15.1281 21.886 14.9969L20.8403 10.983C20.0911 8.10773 19.7166 6.67008 18.6361 5.83504C17.5556 5 16.07 5 13.0987 5L10.8855 5C7.91888 5 6.43556 5 5.35584 5.83306C4.27612 6.66613 3.89982 8.10093 3.14723 10.9705L2.09126 14.9969C2.06085 15.1281 2.03805 15.2594 2.02284 15.3906C2.00764 15.5219 2.00004 15.6531 2.00004 15.7844C2.03044 16.674 2.36872 17.4323 3.01486 18.0594Z"
        />
        <path
          d="M8.495 8.50781V12.5078M10.5 10.5028L6.5 10.5028"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M16.75 9.125V9.25M17 9.25C17 9.38807 16.8881 9.5 16.75 9.5C16.6119 9.5 16.5 9.38807 16.5 9.25C16.5 9.11193 16.6119 9 16.75 9C16.8881 9 17 9.11193 17 9.25Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14.25 11.625V11.75M14.5 11.75C14.5 11.8881 14.3881 12 14.25 12C14.1119 12 14 11.8881 14 11.75C14 11.6119 14.1119 11.5 14.25 11.5C14.3881 11.5 14.5 11.6119 14.5 11.75Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      className={`${className} translate-x-[1px]`}
    >
      <path d="M18.8906 12.846C18.5371 14.189 16.8667 15.138 13.5257 17.0361C10.296 18.8709 8.6812 19.7884 7.37983 19.4196C6.8418 19.2671 6.35159 18.9776 5.95624 18.5787C5 17.6139 5 15.7426 5 12C5 8.2574 5 6.3861 5.95624 5.42132C6.35159 5.02245 6.8418 4.73288 7.37983 4.58042C8.6812 4.21165 10.296 5.12907 13.5257 6.96393C16.8667 8.86197 18.5371 9.811 18.8906 11.154C19.0365 11.7084 19.0365 12.2916 18.8906 12.846Z" />
    </svg>
  );
}

export function JoinScreen() {
  const state = useRoomSession();

  if (state.status === "blocked") {
    return <RoomUnavailable reason={state.reason} />;
  }
  // Nothing resolved yet: the shell paints instantly and the sheet fills in a
  // moment later. Placeholder content goes back here once it's worth showing.
  if (state.status === "loading") return <RoomShell />;

  const session = state.session;
  const preview = session.preview;

  const room = {
    name: roomDisplayName({
      roomName: preview?.roomName,
      title: preview?.title,
      groupId: session.groupId,
      viewerId: session.user.id,
    }),
    // the bot gates avatars behind the same room token as media
    avatarUrl: withRoomToken(preview?.avatarUrl, session.token),
    activity: (preview?.current
      ? {
          kind: preview.current.video ? "video" : "music",
          title: preview.current.title,
        }
      : null) as Activity,
    participants: preview?.participants ?? [],
  };

  // pulled out of `room` so the bar below narrows to a non-null activity
  const activity = room.activity;

  return (
    <RoomShell>
      {/* Only while something is playing. With an idle room the bar was a
          full-width slab and an empty tile saying "Nothing playing yet" - a
          lot of furniture to report an absence the screen below already
          reads as. Gone, the banner and room name simply sit higher. */}
      {activity && (
        <div className="absolute inset-x-4.5 top-4.5 flex h-14 items-center gap-3.5 rounded-2xl bg-secondary px-1.5">
          <span
            className={`flex h-11 w-11.5 shrink-0 items-center justify-center rounded-xl ${ACTIVITY_TILE[activity.kind]}`}
          >
            <ActivityIcon
              kind={activity.kind}
              className={`size-[28px] shrink-0 ${ACTIVITY_ICON_COLOR[activity.kind]}`}
            />
          </span>
          {siteConfig.features.activityVerb && (
            <span className="shrink-0 text-[16px] text-muted-foreground">
              {ACTIVITY_VERB[activity.kind]}
            </span>
          )}
          <MarqueeText
            text={activity.title}
            className="text-[17px] font-[470] text-secondary-foreground"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        <div className="flex w-full flex-col items-center">
          <div className="relative w-full">
            <AvatarBanner
              avatarUrl={room.avatarUrl}
              className="h-28 w-full rounded-2xl"
            />

            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[55%]">
              {room.avatarUrl ? (
                <img
                  src={room.avatarUrl}
                  alt=""
                  // same fetch the banner samples for its colour - see
                  // avatar-banner.tsx; drop this and the avatar is fetched twice
                  crossOrigin="anonymous"
                  width={74}
                  height={74}
                  className="size-17 shrink-0 rounded-full object-cover ring-4 ring-sheet"
                />
              ) : (
                <span className="bg-gradient-avatar flex size-17 shrink-0 items-center justify-center rounded-full font-display text-[34px] font-medium text-[oklch(97%_0.020_268)] ring-4 ring-sheet">
                  {initial(room.name)}
                </span>
              )}
            </div>
          </div>

          <div className="mt-16 flex max-w-full flex-col items-center gap-1.5 text-center">
            <div className="flex max-w-full items-center justify-center gap-2">
              <h1 className="max-w-full truncate text-[21px] leading-tight font-medium tracking-tight">
                {room.name}
              </h1>
              <span className="inline-flex shrink-0 items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                {session.mode === "3d" ? "3D" : "2D"}
              </span>
            </div>
            <p className="max-w-full truncate text-[15.5px] text-muted-foreground">
              {participantsLabel(room.participants.map((p) => p.name))}
            </p>
          </div>
        </div>

        {/*
          Where Join goes is the room's decision, not this screen's.

          A room set to 2D opens the player and a room set to 3D opens the
          lounge, and the difference is one field on the session - so the button
          is the same button either way and nobody has to be offered a choice
          the room has already made.
        */}
        <Link
          href={roomPath(session.mode)}
          className="flex h-12.5 w-72 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-primary px-12 text-[17px] font-medium tracking-[-0.2px] text-primary-foreground transition-[scale] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none will-change-transform active:scale-[0.975] active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)]"
        >
          Join Room
        </Link>
      </div>
    </RoomShell>
  );
}
