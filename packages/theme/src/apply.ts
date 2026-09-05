import type { ThemeMode, ThemePack } from '@nynxz/zenkit-types'
import { getPack } from './registry'
import { BASE_TOKENS } from './base'

const ROOT_ATTR = 'data-zen-pack'

/** Modes a pack supports: its explicit `modes`, else derived from which token
 *  variants it defines. Always at least one (falls back to dark). */
export function packModes(pack: ThemePack | string): ThemeMode[] {
  const p = typeof pack === 'string' ? getPack(pack) : pack
  if (!p) return []
  if (p.modes?.length) return p.modes
  const m: ThemeMode[] = []
  if (p.tokens.light) m.push('light')
  if (p.tokens.dark) m.push('dark')
  return m.length ? m : ['dark']
}

/** Resolve a pack's tokens for a mode, falling back to whichever variant exists. */
export function resolveTokens(pack: ThemePack, mode: ThemeMode): Record<string, string> {
  const t = pack.tokens
  return (mode === 'dark' ? t.dark : t.light) ?? t.light ?? t.dark ?? {}
}

export interface ApplyOptions {
  /** Element to write CSS custom properties onto (default `document.documentElement`). */
  target?: HTMLElement
  /** Also toggle ComfyUI's `.dark-theme` body class (default true). */
  toggleBodyClass?: boolean
}

// Keys written by the previous apply, cleared before the next so a pack's extra
// (non-standard) tokens don't leak into the one that replaces it.
let lastKeys: string[] = []

/** Apply a registered pack + mode. Base defaults are always written (so UI renders
 *  even for partial or unknown packs); the pack overlays them. If the pack doesn't
 *  support the requested mode, clamps to one it does and returns the applied mode. */
export function applyPack(
  id: string,
  requestedMode: ThemeMode,
  opts: ApplyOptions = {},
): ThemeMode {
  const pack = getPack(id)
  const modes = pack ? packModes(pack) : (['dark'] as ThemeMode[])
  const mode = modes.includes(requestedMode) ? requestedMode : (modes[0] ?? requestedMode)
  const target = opts.target ?? document.documentElement

  for (const k of lastKeys) target.style.removeProperty(k)

  const tokens = { ...BASE_TOKENS, ...(pack ? resolveTokens(pack, mode) : {}) }
  for (const [k, v] of Object.entries(tokens)) target.style.setProperty(k, v)
  lastKeys = Object.keys(tokens)

  if (pack) target.setAttribute(ROOT_ATTR, id)
  else target.removeAttribute(ROOT_ATTR)

  if (opts.toggleBodyClass !== false && typeof document !== 'undefined') {
    document.body.classList.toggle('dark-theme', mode === 'dark')
  }
  return mode
}
