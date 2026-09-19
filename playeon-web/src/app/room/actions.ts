"use server";

import {
  joinRoom as resolveSession,
  type JoinRoomResult,
} from "@/server/join-room";

/**
 * The only server entry point the room screens call.
 *
 * `initDataRaw` has to come from the client - it lives in the Telegram
 * WebApp bridge, which the server can't reach - so it is re-verified on every
 * call rather than trusted from a prior one.
 */
export async function joinRoomAction(input: {
  initDataRaw: string | null;
  startParam: string | null;
}): Promise<JoinRoomResult> {
  return resolveSession(input);
}
