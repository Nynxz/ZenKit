// ComfyUI / comfyui-desktop bridge for ZenKit's theme switches.
//
// ComfyUI's single source of truth for "what theme is active" is the `Comfy.ColorPalette`
// setting. Writing it makes ComfyUI toggle `.dark-theme`, reload its palette vars, and —
// crucially for comfyui-desktop — call electronAPI().changeTheme() to recolor the native
// window titlebar (GraphView.vue watches the active palette). So to make a ZenKit theme
// switch behave like ComfyUI's own, we push light/dark into that setting. And to react to
// ComfyUI's own theme menu (its logo→Theme menu / Toggle-Theme command), we observe the
// `.dark-theme` class and mirror it back into ZenKit's mode.
//
// Everything here is defensive: the ComfyUI `app` surface varies by version, so every access
// is guarded and silently no-ops rather than throwing into ZenKit's boot.

import { app } from '@comfy/app'
import { theme } from './theme'
import { zdebug } from './log'

const SETTING = 'Comfy.ColorPalette'
// Neutral core palettes shipped by ComfyUI — used only to flip ComfyUI's notion of
// light/dark when its current palette disagrees with ZenKit's mode.
const DARK_PALETTE = 'dark'
const LIGHT_PALETTE = 'light'

function getComfySetting(id: string): unknown {
  try {
    const em = app?.extensionManager
    if (em?.setting?.get) return em.setting.get(id)
    const s = app?.ui?.settings
    if (s?.getSettingValue) return s.getSettingValue(id)
  } catch {
    /* version mismatch / not ready */
  }
  return undefined
}
function setComfySetting(id: string, value: unknown): void {
  try {
    const em = app?.extensionManager
    if (em?.setting?.set) {
      em.setting.set(id, value)
      return
    }
    const s = app?.ui?.settings
    if (s?.setSettingValue) s.setSettingValue(id, value)
  } catch {
    /* ignore */
  }
}

// Is ComfyUI's *currently active* palette a dark one? Prefer the palette store's own
// light_theme flag (so a user-picked custom palette is read correctly); fall back to the
// body class. This lets pushMode() leave a compatible palette alone instead of stomping it.
function comfyActiveIsDark(): boolean {
  try {
    const active = app?.extensionManager?.colorPalette?.getActiveColorPalette?.()
    if (active && typeof active.light_theme === 'boolean') return !active.light_theme
  } catch {
    /* ignore */
  }
  return typeof document !== 'undefined' && document.body.classList.contains('dark-theme')
}

let started = false
// Set while we're the ones writing the ComfyUI setting, so the class MutationObserver
// doesn't treat ComfyUI's resulting `.dark-theme` toggle as a user-initiated change.
let suppress = false

// ZenKit → ComfyUI. Only when a ZenKit pack is active: under the 'comfy' pack ComfyUI owns
// the palette and we must not clobber whatever the user picked in ComfyUI's own menu. We
// only switch when ComfyUI's light/dark disagrees with ours, so a specific compatible
// palette (e.g. a custom dark theme) is preserved.
function pushMode(): void {
  if (theme.current() === 'comfy') return
  const wantDark = theme.currentMode() === 'dark'
  if (comfyActiveIsDark() === wantDark) return
  suppress = true
  setComfySetting(SETTING, wantDark ? DARK_PALETTE : LIGHT_PALETTE)
  zdebug('[ZenKit] pushed Comfy.ColorPalette →', wantDark ? DARK_PALETTE : LIGHT_PALETTE)
  // Release after the change has propagated through ComfyUI's synchronous watchers.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => (suppress = false))
  else suppress = false
}

// ComfyUI → ZenKit. The `.dark-theme` body class is the one signal every ComfyUI palette
// (core or custom, menu or command) ultimately drives, so we key off it. setMode() no-ops
// when the value is unchanged, which (together with `suppress`) keeps this loop-safe.
function pullMode(): void {
  if (suppress) return
  const comfyDark = document.body.classList.contains('dark-theme')
  if (comfyDark === (theme.currentMode() === 'dark')) return
  theme.setMode(comfyDark ? 'dark' : 'light')
}

// --- ComfyUI's own palettes ("1.0 themes"), for the menu's Comfy tab -----------------------
// ComfyUI's core palette ids are a fixed set (src/constants/coreColorPalettes.ts); user-made
// ones live in the `Comfy.CustomColorPalettes` setting. There's no public "list palettes" API,
// so we combine the known core ids with that setting. Each palette is inherently light or dark
// (ComfyUI has no separate light/dark toggle), so the list itself IS the light/dark choice.
const CORE_COMFY_PALETTES: { id: string; name: string }[] = [
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' },
  { id: 'solarized', name: 'Solarized' },
  { id: 'arc', name: 'Arc' },
  { id: 'nord', name: 'Nord' },
  { id: 'github', name: 'GitHub' },
]

/** All ComfyUI palettes (core + user custom), for the menu's "1.0" tab. */
export function listComfyPalettes(): { id: string; name: string }[] {
  const out = CORE_COMFY_PALETTES.slice()
  try {
    const custom = getComfySetting('Comfy.CustomColorPalettes') as
      Record<string, { name?: string }> | undefined
    if (custom && typeof custom === 'object') {
      for (const [id, p] of Object.entries(custom)) {
        if (!out.some((x) => x.id === id)) out.push({ id, name: p?.name || id })
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

/** The active ComfyUI palette id (for highlighting the Comfy tab). */
export function getComfyPalette(): string | undefined {
  const v = getComfySetting('Comfy.ColorPalette')
  return typeof v === 'string' ? v : undefined
}

/** Apply a ComfyUI palette: reset ZenKit to its default ('comfy' pack, dropping our token
 *  layer so the palette renders cleanly) and load the palette through ComfyUI's own setting. */
export function applyComfyPalette(id: string): void {
  theme.setPack('comfy') // reset — ZenKit's overrides would otherwise "ruin" the comfy palette
  setComfySetting('Comfy.ColorPalette', id)
}

/** Start syncing ZenKit's theme with ComfyUI (+ comfyui-desktop). Returns a stop fn. */
export function startComfyThemeBridge(): () => void {
  if (started || typeof document === 'undefined') return () => {}
  started = true

  const offTheme = theme.onChange(() => pushMode())
  const obs = new MutationObserver(() => pullMode())
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] })

  // Initial sync so the desktop titlebar / chrome matches the restored ZenKit theme on load.
  pushMode()

  return () => {
    started = false
    offTheme()
    obs.disconnect()
  }
}
