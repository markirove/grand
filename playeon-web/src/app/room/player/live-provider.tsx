"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { RoomStore, type RoomState } from "@/lib/room-store";

/**
 * Owns the room socket for the player screen.
 *
 * Mounted here rather than in the shared layout on purpose: opening the socket
 * puts you in the participant roster, so the join screen must not do it. You
 * appear to the room at the moment you actually join.
 */

function getWsBase(): string {
  if (typeof window !== "undefined") {
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || /^192\.168\./.test(window.location.hostname) || /^10\./.test(window.location.hostname) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(window.location.hostname);
    if (isLocal) {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${window.location.hostname}:3067`;
    }
  }
  return process.env.NEXT_PUBLIC_ROOM_WS_URL || "https://socket-playeon-bot.xysushi.in";
}

const StoreContext = createContext<RoomStore | null>(null);

export function RoomLiveProvider({
  token,
  children,
}: {
  token: string;
  children: ReactNode;
}) {
  const wsUrl = useMemo(() => getWsBase(), []);
  const store = useMemo(() => new RoomStore(wsUrl, token), [wsUrl, token]);

  useEffect(() => {
    store.start();

    // the roster shows Idle whenever the mini app is backgrounded
    const report = () =>
      store.setPresent(document.visibilityState === "visible");
    report();
    document.addEventListener("visibilitychange", report);

    return () => {
      document.removeEventListener("visibilitychange", report);
      store.destroy();
    };
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useRoomStore(): RoomStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useRoomStore must be used inside RoomLiveProvider");
  return store;
}

/**
 * Subscribe to one slice of room state.
 *
 * Selecting narrowly is what keeps a participant going idle from re-rendering
 * the video element or the queue. Selectors must return a primitive or a
 * reference that is stable between updates - every snapshot field qualifies,
 * since the store replaces the whole snapshot object rather than mutating it.
 */
export function useRoom<T>(select: (state: RoomState) => T): T {
  const store = useRoomStore();
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    // the server render has no socket; every caller handles the empty state
    () => select(store.getState()),
  );
}
