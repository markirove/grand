"use client";

/**
 * What the room shows when nothing is playing.
 *
 * A room can only be filled from Telegram - there is no queue UI in the mini
 * app - so an idle room that says nothing leaves the viewer with no way
 * forward. This spells out the two routes: a command in the bot's chat, or an
 * inline query from whatever chat they are already in.
 */

const BOT = process.env.NEXT_PUBLIC_BOT_USERNAME || "PlayeonProBot";

const COMMANDS: { command: string; argument: string; note: string }[] = [
  { command: "/play", argument: "song or link", note: "Queue audio" },
  { command: "/vplay", argument: "song or link", note: "Queue with video" },
];

/** Opens a Telegram link from inside the mini app, falling back to a plain nav. */
function openTelegram(url: string) {
  try {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(url);
      return;
    }
  } catch {
    // outside Telegram, or an older client without the method
  }
  window.open(url, "_blank", "noopener");
}

export function EmptyState({ className = "" }: { className?: string }) {
  return (
    <section className={`flex flex-col items-center px-2 ${className}`}>
      <h2 className="text-[18px] font-[470] tracking-[-0.1px]">
        Nothing Playing Yet
      </h2>
      <p className="mt-1.5 max-w-[19rem] text-center text-[15px] text-muted-foreground">
        Ask the bot for something and it starts here, in sync for everyone in
        the room.
      </p>

      <ul className="mt-5 flex w-full max-w-sm flex-col gap-2">
        {COMMANDS.map((entry) => (
          <li
            key={entry.command}
            className="flex items-center gap-2.5 rounded-xl bg-secondary px-3 py-2.5"
          >
            <code className="shrink-0 font-mono text-[14px] font-medium text-foreground">
              {entry.command}
            </code>
            <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-muted-foreground">
              {entry.argument}
            </span>
            <span className="shrink-0 text-[13px] text-muted-foreground">
              {entry.note}
            </span>
          </li>
        ))}
      </ul>

      {/* The inline route is the one people miss, so it gets its own line and
          is tappable - it opens the bot rather than only describing it. */}
      <button
        type="button"
        onClick={() => openTelegram(`https://t.me/${BOT}`)}
        className="mt-3 flex w-full max-w-sm cursor-pointer touch-manipulation items-center gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-border transition-[scale] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] select-none active:scale-[0.985] active:duration-150"
      >
        <code className="shrink-0 font-mono text-[14px] font-medium text-primary">
          @{BOT}
        </code>
        <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-muted-foreground">
          song name
        </span>
        <span className="shrink-0 text-[13px] text-muted-foreground">
          In any chat
        </span>
      </button>
    </section>
  );
}
