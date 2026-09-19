"use client";

import { useState } from "react";

import {
  hostOf,
  verdict,
  type ScreenDiagnostics,
} from "./lib/screen-probe";

const TONE: Record<string, string> = {
  ok: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30",
  warn: "bg-amber-400/15 text-amber-200 ring-amber-300/30",
  bad: "bg-rose-400/15 text-rose-200 ring-rose-300/30",
  idle: "bg-white/8 text-white/55 ring-white/15",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 leading-[1.5]">
      <span className="w-[74px] shrink-0 text-white/40">{label}</span>
      <span className="min-w-0 flex-1 break-words text-white/85">{value}</span>
    </div>
  );
}

function corsLine(diagnostics: ScreenDiagnostics): string {
  const { cors } = diagnostics;
  switch (cors.state) {
    case "idle":
      return "-";
    case "pending":
      return "probing…";
    case "readable":
      return `readable (${cors.status}) - cross-origin read allowed`;
    case "opaque":
      return "opaque - server answered, but refuses a cross-origin read";
    case "http":
      return `HTTP ${cors.status} - reachable, but not serving the bytes`;
    case "unreachable":
      return `unreachable - ${cors.detail}`;
  }
}

function elementLine(diagnostics: ScreenDiagnostics): string {
  const { element, anonymous } = diagnostics;
  const mode = anonymous ? "crossOrigin=anonymous" : "no crossOrigin";
  switch (element.state) {
    case "idle":
      return "-";
    case "pending":
      return `loading · ${mode}`;
    case "loaded":
      return `loaded · ${mode}`;
    case "error":
      return `error ${element.code} · ${mode} · ${element.detail}`;
  }
}

function textureLine(diagnostics: ScreenDiagnostics): string {
  const { texture } = diagnostics;
  switch (texture.state) {
    case "idle":
      return "waiting for a frame";
    case "skipped":
      return `skipped - ${texture.reason}`;
    case "ok":
      return "uploaded";
    case "failed":
      return `failed - ${texture.detail}`;
  }
}

export function Diagnostics({
  diagnostics,
}: {
  diagnostics: ScreenDiagnostics;
}) {
  const [open, setOpen] = useState(true);
  const summary = verdict(diagnostics);

  return (
    <div
      className="pointer-events-auto absolute left-2.5 z-50 max-w-[min(30rem,calc(100vw-1.25rem))] text-[11px]"
      style={{ top: "calc(env(safe-area-inset-top) + 0.625rem)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ring-1 backdrop-blur-md ${TONE[summary.tone]}`}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
        <span className="min-w-0 flex-1 font-medium">{summary.text}</span>
        <span className="shrink-0 text-white/40">{open ? "hide" : "show"}</span>
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1 rounded-xl bg-black/55 px-3 py-2.5 font-mono ring-1 ring-white/10 backdrop-blur-md">
          <Row label="mode" value={diagnostics.sourceMode} />
          <Row label="video" value={hostOf(diagnostics.videoUrl) ?? "-"} />
          <Row label="audio" value={hostOf(diagnostics.audioUrl) ?? "-"} />
          <Row label="cors" value={corsLine(diagnostics)} />
          <Row label="element" value={elementLine(diagnostics)} />
          <Row label="texture" value={textureLine(diagnostics)} />
          <Row
            label="frame"
            value={
              diagnostics.frame
                ? `${diagnostics.frame.width}×${diagnostics.frame.height}`
                : "no picture yet"
            }
          />
        </div>
      ) : null}
    </div>
  );
}
