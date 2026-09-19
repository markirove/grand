"use client";

import { useEffect } from "react";

const FULLSCREEN_PLATFORMS = new Set(["android", "ios"]);

const RETRY_DELAYS = [0, 120, 400, 1000];

export function TelegramFullscreen() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    const inTelegram =
      Boolean(tg.initData) || (!!tg.platform && tg.platform !== "unknown");
    if (!inTelegram) return;
    if (!tg.isVersionAtLeast("8.0")) return;

    const safely = (fn: () => void) => {
      try {
        fn();
      } catch {
      }
    };

    if (!FULLSCREEN_PLATFORMS.has(tg.platform ?? "")) {
      safely(() => tg.ready());
      if (tg.isFullscreen) safely(() => tg.exitFullscreen?.());
      const retry = window.setTimeout(() => {
        if (tg.isFullscreen) safely(() => tg.exitFullscreen?.());
      }, 300);
      return () => window.clearTimeout(retry);
    }

    safely(() => tg.ready());

    const timers = RETRY_DELAYS.map((delay) =>
      window.setTimeout(() => {
        if (tg.isFullscreen) return;
        safely(() => tg.requestFullscreen?.());
      }, delay),
    );

    return () => {
      timers.forEach(window.clearTimeout);
      safely(() => tg.exitFullscreen?.());
    };
  }, []);

  return null;
}
