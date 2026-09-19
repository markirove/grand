"use client";

import { useState } from "react";

type Props = {
  text: string;
  className?: string;
};

export function TrackTitle({ text, className }: Props) {
  const [clipped, setClipped] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setClipped((value) => !value)}
      aria-expanded={!clipped}
      className={`block w-full cursor-pointer text-left ${className ?? ""}`}
    >
      <span className={clipped ? "block truncate" : "block"}>{text}</span>
    </button>
  );
}
