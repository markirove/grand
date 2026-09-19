
function rand(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

const STEPS: { afterMs: number; min: number; max: number }[] = [
  { afterMs: 1600, min: 54, max: 71 },
  { afterMs: 2800, min: 87, max: 95 },
]

export async function withFakeProgress<T>(
  paint: (percent: number) => unknown,
  run: () => Promise<T>,
): Promise<T> {
  await paint(rand(6, 18))

  const timers: NodeJS.Timeout[] = []
  let at = 0
  for (const step of STEPS) {
    at += step.afterMs
    const timer = setTimeout(() => void paint(rand(step.min, step.max)), at)
    timer.unref?.()
    timers.push(timer)
  }

  try {
    return await run()
  } finally {
    for (const timer of timers) clearTimeout(timer)
  }
}
