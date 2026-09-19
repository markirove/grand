import type { ReactNode } from "react";

import { RoomSessionProvider } from "./session-provider";

/**
 * Both room screens share one session, so the token minted for the join
 * screen's preview is the same one the player opens its socket with - tapping
 * Join costs a client-side navigation, not another verification round trip.
 */
export default function RoomLayout({ children }: { children: ReactNode }) {
  return <RoomSessionProvider>{children}</RoomSessionProvider>;
}
