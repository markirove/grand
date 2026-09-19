"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { RoomBlockReason, RoomSession } from "@/server/join-room";

import { joinRoomAction } from "./actions";

type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: RoomSession }
  | { status: "blocked"; reason: RoomBlockReason };

const SessionContext = createContext<SessionState>({ status: "loading" });

export function useRoomSession(): SessionState {
  return useContext(SessionContext);
}

export function useSession(): RoomSession | null {
  const state = useRoomSession();
  return state.status === "ready" ? state.session : null;
}

export function RoomSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const launch = () => {
      const tg = window.Telegram?.WebApp;
      const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      let urlParam = search ? (search.get("g") || search.get("start_param") || search.get("room")) : null;
      if (urlParam && (search?.get("mode") === "3d" || search?.get("m") === "3d")) {
        urlParam = `${urlParam}_3d`;
      }
      return {
        initDataRaw: tg?.initData ?? null,
        startParam: tg?.initDataUnsafe?.start_param ?? urlParam ?? null,
      };
    };

    void (async () => {
      const { initDataRaw, startParam } = launch();
      try {
        const result = await joinRoomAction({ initDataRaw, startParam });
        if (cancelled) return;
        setState(
          result.ok
            ? { status: "ready", session: result.session }
            : { status: "blocked", reason: result.reason },
        );
      } catch {
        if (!cancelled) setState({ status: "blocked", reason: "not-found" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
    The room's paint, hung on the document rather than on a wrapper.

    The 2D player, the join screen and the sheets are not one subtree - some of
    them are fixed overlays that escape whatever element the session lives in -
    and the stylesheet's own tokens are defined on `html`. Setting the attribute
    there is the only place a style rule can reach all of it at once, and it
    means a component gets themed by existing in the room rather than by being
    told about the theme.

    Removed on the way out so a room's colours cannot outlive the session that
    chose them.
  */
  const style = state.status === "ready" ? state.session.style : null;

  useEffect(() => {
    if (!style) return;
    const root = document.documentElement;
    root.dataset.roomStyle = style;
    return () => {
      delete root.dataset.roomStyle;
    };
  }, [style]);

  return (
    <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
  );
}
