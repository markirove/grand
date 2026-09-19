import type { CSSProperties } from "react";

import { avatarHue, initial } from "@/lib/avatar";

import type { LaneParticipant, Presence } from "./participants-lane";

type Props = {
  people: LaneParticipant[];
  className?: string;
};

const PRESENCE: Record<Presence, { label: string; dot: string }> = {
  present: { label: "Present", dot: "bg-presence-online" },
  idle: { label: "Idle", dot: "bg-presence-idle" },
};

export function PeopleList({ people, className }: Props) {
  return (
    <section className={className}>
      {people.length === 0 ? (
        <p className="px-2 py-4 text-center text-[15px] text-muted-foreground">
          No one else is here yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {people.map((person) => {
            const presence = PRESENCE[person.presence ?? "present"];
            return (
              <li
                key={person.id}
                className="flex items-center gap-3 rounded-xl px-2 py-2"
              >
                {person.avatarUrl ? (
                  <img
                    src={person.avatarUrl}
                    alt=""
                    width={44}
                    height={44}
                    className="size-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    style={
                      {
                        "--avatar-hue": avatarHue(person.id + person.name),
                      } as CSSProperties
                    }
                    className="bg-avatar-tint flex size-11 shrink-0 items-center justify-center rounded-full font-display text-[21px] font-medium text-[oklch(97%_0.02_var(--avatar-hue))]"
                  >
                    {initial(person.name)}
                  </span>
                )}

                <span className="flex min-w-0 flex-1 flex-col gap-[3.2px]">

                  <span className="truncate text-[15.8px] leading-[1.32] font-[480] tracking-[-0.1px]">
                    {person.name}
                  </span>

                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[1.35] font-normal text-muted-foreground">
                    <span
                      className={`size-[6px] shrink-0 rounded-full ${presence.dot}`}
                    />
                    <span className="truncate">{presence.label}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
