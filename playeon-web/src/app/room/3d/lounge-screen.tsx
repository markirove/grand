"use client";

import { RoomUnavailable } from "../room-unavailable";
import { useRoomSession } from "../session-provider";
import { RoomLiveProvider } from "../player/live-provider";
import { LoungeStage } from "./lounge-stage";

export function LoungeScreen() {
  const state = useRoomSession();

  if (state.status === "blocked") {
    return <RoomUnavailable reason={state.reason} />;
  }
  if (state.status !== "ready") {
    return <div className="fixed inset-0 bg-[#0b0b11]" />;
  }

  return (
    <RoomLiveProvider token={state.session.token}>
      <LoungeStage token={state.session.token} style={state.session.style} />
    </RoomLiveProvider>
  );
}
