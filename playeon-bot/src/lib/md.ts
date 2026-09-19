import { md } from '@mtcute/markdown-parser'

export type Fragment = ReturnType<typeof md>

function isBlank(part: Fragment | null | undefined): boolean {
  return !part || part.text.length === 0
}

export function joinMd(sep: string, parts: (Fragment | null | undefined)[]): Fragment {
  return (
    parts
      .filter((p): p is Fragment => !isBlank(p))
      .reduce<Fragment | null>((acc, part) => (acc ? md`${acc}${sep}${part}` : part), null) ?? md``
  )
}

export function lines(...parts: (Fragment | null | undefined)[]): Fragment {
  return joinMd('\n', parts)
}

export function paragraphs(...parts: (Fragment | null | undefined)[]): Fragment {
  return joinMd('\n\n', parts)
}
