import type { Metadata } from "next";

import { JoinScreen } from "./join-screen";

export const metadata: Metadata = {
  title: "Join room",
};

/**
 * Stays a server component purely to own `metadata`; the screen itself needs
 * the Telegram bridge, which only exists in the browser.
 */
export default function RoomJoinPage() {
  return <JoinScreen />;
}
