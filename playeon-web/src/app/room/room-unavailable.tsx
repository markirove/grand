"use client";

import { closeMiniApp } from "@/lib/room-store";

import { RoomShell } from "./room-shell";

export type RoomBlockReason = "forbidden" | "expired" | "ended" | "not-found";

const COPY: Record<
  RoomBlockReason,
  { title: string; description: string; action: string }
> = {
  forbidden: {
    title: "This Room's Private",
    description:
      "Only people the host invites can see what's playing here. Ask them to send you a fresh link.",
    action: "Close",
  },
  expired: {
    title: "Invite Expired",
    description:
      "This link isn't valid anymore. Ask the host to share the room again.",
    action: "Close",
  },
  ended: {
    title: "Room Ended",
    description:
      "The host closed this room. Anything that was playing has stopped.",
    action: "Close",
  },
  "not-found": {
    title: "Room Not Found",
    description:
      "We couldn't find this room. It may have been deleted, or the link is broken.",
    action: "Close",
  },
};

const ICON_CLASS = "size-8 shrink-0 text-muted-foreground";

function BlockIcon({ reason }: { reason: RoomBlockReason }) {
  if (reason === "expired") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ICON_CLASS}
      >
        <path d="M7 3H20" />
        <path d="M5.5 21V18.9696C5.5 17.7277 6.07682 16.5563 7.06116 15.7991L12 12" />
        <path d="M4 21H21" />
        <path d="M2 2L22 22" />
        <path d="M18.5 3V5.03039C18.5 6.27227 17.9232 7.4437 16.9388 8.20089L14.2609 10.2609" />
      </svg>
    );
  }

  if (reason === "ended") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ICON_CLASS}
      >
        <path d="M9.00749 9L12 11.9963M12 11.9963L15 15M12 11.9963L9 15M12 11.9963L14.9925 9" />
        <path d="M14.3942 3.00083L14.1481 2.79115C12.9103 1.73628 11.0897 1.73628 9.85189 2.79115L9.60584 3.00083C8.96518 3.54679 8.16862 3.87674 7.32956 3.9437L7.00731 3.96941C5.38613 4.09878 4.09878 5.38613 3.96941 7.00731L3.9437 7.32956C3.87674 8.16862 3.54679 8.96518 3.00083 9.60584L2.79115 9.85189C1.73628 11.0897 1.73628 12.9103 2.79115 14.1481L3.00083 14.3942C3.54679 15.0348 3.87674 15.8314 3.9437 16.6704L3.96941 16.9927C4.09878 18.6139 5.38613 19.9012 7.00731 20.0306L7.32956 20.0563C8.16862 20.1233 8.96518 20.4532 9.60584 20.9992L9.85188 21.2089C11.0897 22.2637 12.9103 22.2637 14.1481 21.2089L14.3942 20.9992C15.0348 20.4532 15.8314 20.1233 16.6704 20.0563L16.9927 20.0306C18.6139 19.9012 19.9012 18.6139 20.0306 16.9927L20.0563 16.6704C20.1233 15.8314 20.4532 15.0348 20.9992 14.3942L21.2089 14.1481C22.2637 12.9103 22.2637 11.0897 21.2089 9.85188L20.9992 9.60584C20.4532 8.96518 20.1233 8.16862 20.0563 7.32956L20.0306 7.00731C19.9012 5.38613 18.6139 4.09878 16.9927 3.96941L16.6704 3.9437C15.8314 3.87674 15.0348 3.54679 14.3942 3.00083Z" />
      </svg>
    );
  }

  if (reason === "not-found") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ICON_CLASS}
      >
        <path d="M9.5 9C9.5 7.61929 10.6193 6.5 12 6.5C13.3807 6.5 14.5 7.61929 14.5 9C14.5 9.85691 14.0689 10.6131 13.4117 11.0636C12.7283 11.5319 12 12.1716 12 13" />
        <path d="M12.125 16.25H12M12.25 16.25C12.25 16.3881 12.1381 16.5 12 16.5C11.8619 16.5 11.75 16.3881 11.75 16.25C11.75 16.1119 11.8619 16 12 16C12.1381 16 12.25 16.1119 12.25 16.25Z" />
        <path d="M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z" />
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
      strokeLinecap="round"
      strokeLinejoin="round"
      className={ICON_CLASS}
    >
      <path d="M4.5 4.5L18 18" />
      <path d="M18.7088 3.49534C16.8165 2.55382 14.5009 2 12 2C9.4991 2 7.1835 2.55382 5.29116 3.49534C4.36318 3.95706 3.89919 4.18792 3.4496 4.91378C3 5.63965 3 6.34248 3 7.74814V11.2371C3 16.9205 7.54236 20.0804 10.173 21.4338C10.9067 21.8113 11.2735 22 12 22C12.7265 22 13.0933 21.8113 13.8269 21.4338C16.4576 20.0804 21 16.9205 21 11.2371L21 7.74814C21 6.34249 21 5.63966 20.5504 4.91378C20.1008 4.18791 19.6368 3.95706 18.7088 3.49534Z" />
    </svg>
  );
}

export function RoomUnavailable({ reason }: { reason: RoomBlockReason }) {
  const copy = COPY[reason];

  return (
    <RoomShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-10">
        <div className="flex w-full flex-col items-center">
          <span className="flex size-17 shrink-0 items-center justify-center rounded-full bg-secondary">
            <BlockIcon reason={reason} />
          </span>

          <div className="mt-5 flex max-w-full flex-col items-center gap-2.5">
            <h1 className="max-w-full truncate text-[21px] leading-tight font-[480] tracking-tight">
              {copy.title}
            </h1>
            <p className="max-w-[15rem] text-center text-[16px] text-muted-foreground">
              {copy.description}
            </p>
          </div>
        </div>

        {/* Telegram's own `WebApp.close()`. There is nowhere for this screen to
            navigate to - the mini app was opened straight onto a room that
            cannot be shown - so the only honest thing the button can do is
            dismiss. It was rendering with no handler at all, which made it a
            button that looked live and did nothing. */}
        <button
          type="button"
          onClick={closeMiniApp}
          className="h-12.5 w-72 cursor-pointer touch-manipulation rounded-full bg-secondary text-[17px] font-medium tracking-[-0.2px] text-secondary-foreground transition-[scale,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none will-change-transform active:scale-[0.975] active:bg-secondary-active active:duration-150 active:ease-[cubic-bezier(0.33,0,0.67,1)]"
        >
          {copy.action}
        </button>
      </div>
    </RoomShell>
  );
}
