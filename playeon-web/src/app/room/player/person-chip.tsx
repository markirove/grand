import type { CSSProperties } from "react";

import { avatarHue, initial } from "@/lib/avatar";

export type Person = {
  name: string;
  avatarUrl?: string | null;
};

type Props = {
  person: Person;
  size?: number;
  pill?: boolean;
  className?: string;
  nameClassName?: string;
};

export function PersonChip({
  person,
  size = 26,
  pill = false,
  className,
  nameClassName = "text-[14.5px]",
}: Props) {
  const shell = pill ? "rounded-full bg-secondary py-0.5 pr-3 pl-0.5" : "";

  return (
    <span
      className={`flex min-w-0 items-center gap-2 ${shell} ${className ?? ""}`}
    >
      {person.avatarUrl ? (
        <img
          src={person.avatarUrl}
          alt=""
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className="shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          style={
            {
              width: size,
              height: size,
              fontSize: Math.round(size * 0.46),
              "--avatar-hue": avatarHue(person.name),
            } as CSSProperties
          }
          className="bg-avatar-tint flex shrink-0 items-center justify-center rounded-full font-display font-medium text-[oklch(97%_0.02_var(--avatar-hue))]"
        >
          {initial(person.name)}
        </span>
      )}
      <span className={`truncate ${nameClassName}`}>{person.name}</span>
    </span>
  );
}
