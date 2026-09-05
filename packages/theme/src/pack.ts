import type { ThemePack } from '@nynxz/zenkit-types'

export type { ThemePack }

const MODES = ['light', 'dark'] as const

/** Validate untrusted data (a user-supplied JSON theme) into a ThemePack, or
 *  null if it isn't usable. Keeps only string→string token entries, so a
 *  malformed file can't inject anything but CSS custom-property values. `css`,
 *  when present, must be a string — it's injected verbatim into a `<style>` (it
 *  can't run script), so it's kept as-is, not sanitized; themes are trusted,
 *  local content. */
export function parsePack(data: unknown): ThemePack | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (typeof d.id !== 'string' || typeof d.name !== 'string') return null
  if (!d.tokens || typeof d.tokens !== 'object') return null

  const raw = d.tokens as Record<string, unknown>
  const tokens: ThemePack['tokens'] = {}
  for (const mode of MODES) {
    const set = raw[mode]
    if (!set || typeof set !== 'object') continue
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(set as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    if (Object.keys(out).length) tokens[mode] = out
  }
  if (!tokens.light && !tokens.dark) return null

  const modes = Array.isArray(d.modes)
    ? (d.modes.filter((m) => m === 'light' || m === 'dark') as ('light' | 'dark')[])
    : undefined

  const css = typeof d.css === 'string' && d.css.trim() ? d.css : undefined

  return {
    id: d.id,
    name: d.name,
    ...(modes && modes.length ? { modes } : {}),
    tokens,
    ...(css ? { css } : {}),
  }
}
