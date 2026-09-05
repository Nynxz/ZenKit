// The --zen-* alias layer: derives ZenKit's component tokens (what @nynxz/zenkit-ui
// reads) from the semantic shadcn tokens a pack sets. Pure — returns a map of
// CSS custom properties; the caller writes them onto an element.
//
// Inside ComfyUI, @nynxz/zenkit-core derives the same --zen-* set from the host's
// resolved theme. This pure version lets the same components be themed anywhere
// the runtime isn't present (the docs site, Storybook-style demos, etc.) without
// reimplementing the contrast logic — keeping every surface consistent.

// Parse a hex / rgb() colour to [r,g,b] (0-255), or null for forms we can't read
// (var(), hsl, oklch, named) — the caller then falls back to --primary-foreground.
function parseRgb(c: string): [number, number, number] | null {
  const s = (c || '').trim()
  let m = s.match(/^#([0-9a-f]{3})$/i)
  if (m) {
    const h = m[1]!
    return [0, 1, 2].map((i) => parseInt(h[i]! + h[i]!, 16)) as [number, number, number]
  }
  m = s.match(/^#([0-9a-f]{6})$/i)
  if (m) {
    const h = m[1]!
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i)
  if (m) return [+m[1]!, +m[2]!, +m[3]!]
  return null
}

/**
 * Pick black or white text for a background by whichever gives more WCAG
 * contrast — fixes unreadable white-on-light-accent (e.g. a volt-yellow primary).
 * Returns null when the colour can't be parsed (oklch/hsl/var), so the caller
 * can fall back to the pack's own --primary-foreground.
 */
export function readableText(bg: string): string | null {
  const rgb = parseRgb(bg)
  if (!rgb) return null
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#15151a'
}

/**
 * Derive the --zen-* component tokens from a resolved shadcn token map.
 * Mirrors @nynxz/zenkit-core's host derivation so @nynxz/zenkit-ui renders identically
 * wherever this is applied. Notably, --zen-accent-text uses readableText so a
 * light accent gets dark text instead of unreadable white.
 */
export function zenAliases(tokens: Record<string, string>): Record<string, string> {
  const g = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = tokens[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    return undefined
  }
  const out: Record<string, string> = {}
  const set = (k: string, v?: string) => {
    if (v) out[k] = v
  }

  set('--zen-bg', g('--background'))
  set('--zen-surface', g('--card', '--background'))
  set('--zen-surface-2', g('--secondary', '--muted', '--card'))
  set('--zen-input', g('--input', '--secondary'))
  set('--zen-text', g('--foreground'))
  set('--zen-muted', g('--muted-foreground', '--foreground'))
  set('--zen-border', g('--border', '--input'))
  const accent = g('--primary', '--accent')
  set('--zen-accent', accent)
  set(
    '--zen-accent-text',
    (accent && readableText(accent)) || g('--primary-foreground', '--background'),
  )
  set('--zen-radius', g('--radius'))
  return out
}
