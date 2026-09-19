import type { Metadata } from "next";

import { PlayerScreen } from "./player-screen";

export const metadata: Metadata = {
  title: "Player",
};

/**
 * Stays a server component purely to own `metadata`; the player itself needs
 * the socket and the Telegram bridge, both of which are browser-only.
 */
export default function PlayerPage() {
  return <PlayerScreen />;
}
