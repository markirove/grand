import type { Metadata } from "next";

import { LoungeScreen } from "./lounge-screen";

export const metadata: Metadata = {
  title: "Lounge",
  description: "The room, in 3D.",
};

export default function Room3DPage() {
  return <LoungeScreen />;
}
