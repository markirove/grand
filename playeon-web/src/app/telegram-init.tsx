"use client";

import { useEffect } from "react";

/**
 * Boots the Telegram Mini App: viewport, theme sync, and safe-area vars.
 *
 * Outside Telegram this is a no-op - the script still loads in a normal
 * browser, but its methods post messages to a client that isn't there and
 * throw `WebAppMethodUnsupported`, so every call is both gated and guarded.
 */
export function TelegramInit() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    // `platform` is "unknown" when the script runs outside a Telegram client.
    const inTelegram =
      Boolean(tg.initData) || (!!tg.platform && tg.platform !== "unknown");
    if (!inTelegram) return;

    const root = document.documentElement;
    const safely = (fn: () => void) => {
      try {
        fn();
      } catch {
        // older clients reject methods they don't implement - ignore
      }
    };

    safely(() => tg.ready());
    safely(() => tg.expand());


    /**
     * Telegram only accepts #rrggbb, but our tokens are oklch(). Round-trip the
     * computed value through a canvas so the browser's own colour parser does
     * the conversion - no hardcoded duplicates of the palette.
     */
    const resolveColor = (token: string, fallback: string) => {
      try {
        const raw = getComputedStyle(root).getPropertyValue(token).trim();
        if (!raw) return fallback;
        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return fallback;
        ctx.fillStyle = raw;
        const resolved = ctx.fillStyle;
        return typeof resolved === "string" && resolved.startsWith("#")
          ? resolved
          : fallback;
      } catch {
        return fallback;
      }
    };

    /**
     * Paint the client chrome from our own surfaces - but one rung off the
     * page colour on each edge. Matching --background exactly makes the header
     * and the app melt into one another with no edge at all.
     */
    const applyChrome = () => {
      const dark = tg.colorScheme === "dark";
      const background = resolveColor(
        "--background",
        dark ? "#101011" : "#f3f3f3",
      );
      const topbar = resolveColor("--topbar", dark ? "#141415" : "#f7f7f7");

      if (tg.isVersionAtLeast("6.9")) {
        safely(() => tg.setBackgroundColor?.(background));
        safely(() => tg.setHeaderColor?.(topbar));
      }
      // the device nav area reads as chrome, not as part of the sheet
      if (tg.isVersionAtLeast("7.10")) {
        safely(() => tg.setBottomBarColor?.(topbar));
      }
    };

    const applyTheme = () => {
      root.dataset.theme = tg.colorScheme === "dark" ? "dark" : "light";
      applyChrome();
    };

    // Telegram exposes these as CSS vars too, but only on newer clients -
    // mirroring them ourselves keeps pt-safe/pb-safe working everywhere.
    const applyInsets = () => {
      const safe = tg.safeAreaInset;
      const content = tg.contentSafeAreaInset;
      if (safe) {
        root.style.setProperty("--tg-safe-area-inset-top", `${safe.top}px`);
        root.style.setProperty(
          "--tg-safe-area-inset-bottom",
          `${safe.bottom}px`,
        );
        root.style.setProperty("--tg-safe-area-inset-left", `${safe.left}px`);
        root.style.setProperty("--tg-safe-area-inset-right", `${safe.right}px`);
      }
      if (content) {
        root.style.setProperty(
          "--tg-content-safe-area-inset-top",
          `${content.top}px`,
        );
      }
    };

    applyTheme();
    applyInsets();

    // swipe-to-close would fight the sheet; disabling landed in Bot API 7.7
    if (tg.isVersionAtLeast("7.7")) {
      safely(() => tg.disableVerticalSwipes?.());
    }

    const events = [
      "themeChanged",
      "safeAreaChanged",
      "contentSafeAreaChanged",
      "fullscreenChanged",
    ] as const;
    const handlers: Record<string, () => void> = {
      themeChanged: applyTheme,
      safeAreaChanged: applyInsets,
      contentSafeAreaChanged: applyInsets,
      fullscreenChanged: applyInsets,
    };

    events.forEach((event) =>
      safely(() => tg.onEvent(event, handlers[event]!)),
    );

    return () => {
      events.forEach((event) =>
        safely(() => tg.offEvent(event, handlers[event]!)),
      );
    };
  }, []);

  return null;
}
