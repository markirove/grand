"use client";

import { useEffect } from "react";

export function ScreenOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[80] select-none">
      <div
        className="absolute inset-x-0 flex justify-center px-4"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <span className="rounded-lg bg-black/45 px-2.5 py-1.5 text-[11px] tracking-wide text-white/45 backdrop-blur-sm">
          <span className="[@media(pointer:coarse)]:hidden">
            Click anywhere or press Esc to go back to the room
          </span>
          <span className="hidden [@media(pointer:coarse)]:inline">
            Tap anywhere to go back to the room
          </span>
        </span>
      </div>
    </div>
  );
}
