import type { ReactNode } from "react";

export function RoomShell({ children }: { children?: ReactNode }) {
  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-background">
      <div className="flex h-[20%] shrink-0 items-center justify-center gap-3 pt-safe px-safe">

        <img
          src="/assets/images/playeon-logo.png"
          alt="Playeon"
          width={50}
          height={50}
          className="size-11 shrink-0 object-contain"
        />
        <span className="text-[24px] leading-none font-medium tracking-tight">
          Playeon
        </span>
      </div>

      <section className="relative flex h-[80%] flex-col rounded-t-sheet bg-sheet px-4.5 pb-safe">
        {children}
      </section>
    </div>
  );
}
