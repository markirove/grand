export type CorsProbe =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "readable"; status: number }
  | { state: "opaque" }
  | { state: "http"; status: number }
  | { state: "unreachable"; detail: string };

export type ElementProbe =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "loaded" }
  | { state: "error"; code: number; detail: string };

export type TextureProbe =
  | { state: "idle" }
  | { state: "skipped"; reason: string }
  | { state: "ok" }
  | { state: "failed"; detail: string };

export type ScreenDiagnostics = {
  sourceMode: "idle" | "download" | "split";
  videoUrl: string | null;
  audioUrl: string | null;
  anonymous: boolean;
  cors: CorsProbe;
  element: ElementProbe;
  texture: TextureProbe;
  frame: { width: number; height: number } | null;
};

export const IDLE_DIAGNOSTICS: ScreenDiagnostics = {
  sourceMode: "idle",
  videoUrl: null,
  audioUrl: null,
  anonymous: true,
  cors: { state: "idle" },
  element: { state: "idle" },
  texture: { state: "idle" },
  frame: null,
};

const MEDIA_ERRORS: Record<number, string> = {
  1: "ABORTED - the fetch was cancelled",
  2: "NETWORK - the transfer failed mid-stream",
  3: "DECODE - bytes arrived but would not decode",
  4: "SRC_NOT_SUPPORTED - refused before playback; under crossOrigin this is what a CORS denial looks like",
};

export function describeMediaError(error: MediaError | null): {
  code: number;
  detail: string;
} {
  const code = error?.code ?? 0;
  const message = error?.message?.trim();
  const named = MEDIA_ERRORS[code] ?? "unknown";
  return { code, detail: message ? `${named} · ${message}` : named };
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function probeCors(
  url: string,
  signal: AbortSignal,
): Promise<CorsProbe> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-1" },
      signal,
      cache: "no-store",
    });
    if (response.ok || response.status === 206) {
      return { state: "readable", status: response.status };
    }
    return { state: "http", status: response.status };
  } catch (error) {
    if (signal.aborted) return { state: "pending" };
    try {
      await fetch(url, {
        method: "GET",
        mode: "no-cors",
        headers: { Range: "bytes=0-1" },
        signal,
        cache: "no-store",
      });
      return { state: "opaque" };
    } catch {
      if (signal.aborted) return { state: "pending" };
      const detail =
        error instanceof Error ? error.message : "fetch failed with no detail";
      return { state: "unreachable", detail };
    }
  }
}

export function verdict(diagnostics: ScreenDiagnostics): {
  tone: "ok" | "warn" | "bad" | "idle";
  text: string;
} {
  const { sourceMode, cors, element, texture } = diagnostics;
  if (sourceMode === "idle") return { tone: "idle", text: "Nothing playing" };

  if (texture.state === "ok") {
    return { tone: "ok", text: "Textured - the screen is live video" };
  }
  if (texture.state === "failed") {
    return { tone: "bad", text: `Texture upload failed · ${texture.detail}` };
  }
  if (element.state === "error") {
    const blamed =
      cors.state === "opaque"
        ? "CORS refused the read, so crossOrigin made the load fail outright"
        : cors.state === "unreachable"
          ? "the URL itself is unreachable - expired mint, most likely"
          : cors.state === "http"
            ? `the server answered ${cors.status}`
            : "the element rejected the source";
    return { tone: "bad", text: `Not playable here · ${blamed}` };
  }
  if (cors.state === "opaque") {
    return {
      tone: "warn",
      text: "Alive but unreadable - playable in 2D, never textureable in 3D",
    };
  }
  if (cors.state === "readable") {
    return { tone: "ok", text: "CORS readable - waiting on the first frame" };
  }
  return { tone: "warn", text: "Probing…" };
}
