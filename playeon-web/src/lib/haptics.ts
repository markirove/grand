/**
 * Telegram haptics, safe to call anywhere: outside a Telegram client the
 * bridge is simply absent, and older clients throw on methods their version
 * predates. A tap that doesn't happen is never worth an exception.
 */

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";

const bridge = () => {
  try {
    return window.Telegram?.WebApp?.HapticFeedback;
  } catch {
    return undefined;
  }
};

/** A physical knock - something arrived, landed, or was dismissed. */
export function impact(style: ImpactStyle = "light") {
  try {
    bridge()?.impactOccurred?.(style);
  } catch {
    // unsupported client version
  }
}

/** The lighter tick for moving through options - tabs, pickers, segments. */
export function selection() {
  try {
    bridge()?.selectionChanged?.();
  } catch {
    // unsupported client version
  }
}
