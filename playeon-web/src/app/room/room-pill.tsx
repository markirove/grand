"use client";

export function RoomPill({
  avatarUrl,
  roomName,
  reconnecting,
}: {
  avatarUrl: string | null;
  roomName: string;
  reconnecting: boolean;
}) {
  return (
    <div className="flex h-[31.8px] max-w-full min-w-0 items-center gap-2 rounded-full bg-topbar-pill/70 pr-3 pl-[2.6px] text-topbar-pill-foreground backdrop-blur-xl backdrop-saturate-150">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          width={27}
          height={27}
          className={`size-[27px] shrink-0 rounded-full object-cover transition-[filter] duration-300 ease-out ${reconnecting ? "grayscale" : ""}`}
        />
      ) : (
        <span
          className={`bg-gradient-avatar flex size-[26px] shrink-0 items-center justify-center rounded-full font-display text-[13px] font-medium text-[oklch(97%_0.020_268)] transition-[filter] duration-300 ease-out ${reconnecting ? "grayscale" : ""}`}
        >
          {roomName.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate text-[14px] font-medium">
        {reconnecting ? "Connecting" : roomName}
      </span>
    </div>
  );
}
