// Theme system: shadcn semantic-token packs → translated to ComfyUI/PrimeVue vars,
// written as ONE `!important` <style> rule (never inline, so ComfyUI's own vars are
// never overwritten/destroyed) + an !important bridge <style> for 2.0 node DOM.
// A pack may also carry custom `css` (header notches, etc.), injected into its own
// <style> only while the pack is active. 'comfy' pack = empty rules (ComfyUI owns
// its vars). Light/dark toggles `.dark-theme`.

import {
  getPack,
  packs as registeredPacks,
  packModes as packModesOf,
  registerPack as registerThemePack,
} from '@nynxz/zenkit-theme'
import type { ThemeMode, ThemePack } from '@nynxz/zenkit-types'
import { ensureStyle } from './dom'

export const ZEN_TOKENS = [
  '--zen-bg',
  '--zen-surface',
  '--zen-surface-2',
  '--zen-input',
  '--zen-text',
  '--zen-muted',
  '--zen-border',
  '--zen-accent',
  '--zen-accent-text',
  '--zen-radius',
] as const

export type { ThemeMode }

// Fill missing core tokens from related ones.
const TOKEN_FALLBACKS: Record<string, string[]> = {
  '--background': ['--base-background', '--bg-color', '--content-bg'],
  '--foreground': ['--base-foreground', '--fg-color', '--content-fg'],
  '--primary': ['--primary-background', '--brand-blue', '--accent-primary'],
  '--primary-foreground': ['--button-surface-contrast', '--base-foreground'],
  '--secondary': ['--secondary-background', '--component-node-widget-background'],
  '--secondary-foreground': ['--component-node-foreground', '--foreground'],
  '--muted': ['--muted-background', '--component-node-widget-background'],
  '--muted-foreground': ['--text-secondary', '--component-node-foreground-secondary'],
  '--accent': ['--accent-background', '--component-node-surface'],
  '--accent-foreground': ['--component-node-foreground', '--foreground'],
  '--border': ['--border-default', '--node-component-border'],
  '--input': ['--input-surface', '--component-node-widget-background'],
  '--card': ['--component-node-background', '--node-component-surface'],
  '--card-foreground': ['--component-node-foreground', '--foreground'],
}

// Translate core tokens → ComfyUI / PrimeVue vars.
const COMFY_MAPPINGS: Array<[string, string[]]> = [
  ['--component-node-background', ['--card', '--background']],
  ['--component-node-border', ['--border', '--node-component-border']],
  ['--component-node-foreground', ['--card-foreground', '--foreground']],
  ['--component-node-foreground-secondary', ['--muted-foreground']],
  ['--component-node-surface', ['--card', '--background']],
  ['--component-node-widget-background', ['--secondary', '--input']],
  ['--component-node-widget-background-hovered', ['--accent', '--secondary']],
  ['--component-node-widget-background-selected', ['--accent', '--primary']],
  ['--component-node-widget-background-highlighted', ['--ring', '--primary']],
  ['--component-node-widget-advanced', ['--primary', '--accent']],
  ['--node-component-header-surface', ['--card', '--background']],
  ['--node-component-header', ['--foreground']],
  ['--node-component-slot-text', ['--muted-foreground', '--foreground']],
  ['--node-component-border', ['--border']],
  ['--node-component-surface', ['--card', '--background']],
  ['--node-component-ring', ['--ring', '--primary']],
  ['--base-background', ['--background']],
  ['--base-foreground', ['--foreground']],
  ['--primary-background', ['--primary']],
  ['--primary-background-hover', ['--accent', '--primary']],
  ['--primary-foreground', ['--primary-foreground', '--foreground']],
  ['--secondary-background', ['--secondary']],
  ['--secondary-background-hover', ['--accent', '--secondary']],
  ['--secondary-background-selected', ['--accent', '--primary']],
  ['--input-surface', ['--input', '--secondary']],
  ['--text-primary', ['--foreground']],
  ['--text-secondary', ['--muted-foreground', '--foreground']],
  ['--border-default', ['--border']],
  ['--bg-color', ['--background']],
  ['--fg-color', ['--foreground']],
  ['--content-bg', ['--card', '--background']],
  ['--comfy-menu-bg', ['--card', '--background']],
  ['--comfy-menu-secondary-bg', ['--secondary', '--card']],
  ['--comfy-input-bg', ['--input', '--secondary']],
  ['--border-color', ['--border']],
  ['--input-text', ['--foreground']],
  ['--descrip-text', ['--muted-foreground']],
  ['--p-primary-color', ['--primary']],
  ['--p-primary-hover-color', ['--primary-background-hover', '--accent', '--primary']],
  ['--p-primary-active-color', ['--primary-background-hover', '--accent', '--primary']],
  ['--p-primary-contrast-color', ['--primary-foreground', '--foreground']],
  ['--p-surface-0', ['--background']],
  ['--p-surface-50', ['--card', '--background']],
  ['--p-surface-100', ['--card', '--secondary']],
  ['--p-surface-200', ['--secondary']],
  ['--p-surface-300', ['--secondary-background-hover', '--accent']],
  ['--p-surface-400', ['--secondary-background-selected', '--accent']],
  ['--p-surface-500', ['--muted']],
  ['--p-surface-600', ['--secondary-background-hover', '--accent']],
  ['--p-surface-700', ['--card', '--background']],
  ['--p-surface-800', ['--background']],
  ['--p-surface-900', ['--background']],
  ['--p-surface-950', ['--background']],
  ['--p-content-background', ['--card', '--background']],
  ['--p-content-color', ['--foreground']],
  ['--p-content-border-color', ['--border']],
  ['--p-text-color', ['--foreground']],
  ['--p-text-muted-color', ['--muted-foreground']],
  ['--p-button-primary-background', ['--primary']],
  ['--p-button-primary-hover-background', ['--primary-background-hover', '--accent', '--primary']],
  ['--p-button-primary-active-background', ['--primary-background-hover', '--accent', '--primary']],
  ['--p-button-primary-border-color', ['--primary']],
  [
    '--p-button-primary-hover-border-color',
    ['--primary-background-hover', '--accent', '--primary'],
  ],
  ['--p-button-primary-color', ['--primary-foreground', '--foreground']],
  ['--p-button-primary-hover-color', ['--primary-foreground', '--foreground']],
  // ComfyUI's own .comfyui-button.primary (the Run/Queue button) uses --primary-bg/-fg,
  // NOT the PrimeVue vars — without these a light --primary (e.g. volt yellow) keeps
  // ComfyUI's default white text → unreadable. Map fg to the pack's primary-foreground.
  ['--primary-bg', ['--primary']],
  ['--primary-fg', ['--primary-foreground', '--foreground']],
  ['--primary-hover-bg', ['--primary-background-hover', '--accent', '--primary']],
  ['--primary-hover-fg', ['--primary-foreground', '--foreground']],
  ['--p-button-secondary-background', ['--secondary']],
  ['--p-button-secondary-hover-background', ['--accent', '--secondary']],
  ['--p-button-secondary-border-color', ['--border']],
  ['--p-button-secondary-color', ['--secondary-foreground', '--foreground']],
  ['--p-togglebutton-background', ['--secondary', '--input']],
  ['--p-togglebutton-border-color', ['--border']],
  ['--p-togglebutton-color', ['--foreground']],
  ['--p-togglebutton-checked-background', ['--primary-background-hover', '--accent', '--primary']],
  [
    '--p-togglebutton-checked-border-color',
    ['--primary-background-hover', '--accent', '--primary'],
  ],
  ['--p-togglebutton-checked-color', ['--foreground']],
  ['--p-form-field-background', ['--input', '--secondary']],
  ['--p-form-field-color', ['--foreground']],
  ['--p-form-field-border-color', ['--border']],
  ['--p-form-field-placeholder-color', ['--muted-foreground']],
  ['--p-tooltip-background', ['--popover', '--card', '--background']],
  ['--p-tooltip-color', ['--popover-foreground', '--card-foreground', '--foreground']],
  ['--p-slider-track-background', ['--input', '--secondary', '--border']],
  ['--p-slider-track-active-background', ['--primary']],
  ['--p-slider-range-background', ['--primary']],
  ['--p-slider-handle-background', ['--primary']],
  ['--p-slider-handle-content-background', ['--primary-foreground', '--background']],

  // ComfyUI 1.44.9 (Tailwind-era) semantic vars the chrome actually reads — the old
  // --p-button-* alone don't recolor buttons/menus on current ComfyUI.
  ['--button-surface', ['--secondary', '--card', '--input']],
  ['--button-hover-surface', ['--accent', '--secondary']],
  ['--button-active-surface', ['--accent', '--primary']],
  ['--button-icon', ['--muted-foreground', '--foreground']],
  ['--button-surface-contrast', ['--primary-foreground', '--foreground']],
  ['--accent-primary', ['--primary', '--accent']],
  ['--accent-background', ['--accent', '--secondary']],
  ['--nav-background', ['--card', '--background']],
  ['--interface-menu-surface', ['--popover', '--card', '--background']],
  ['--interface-menu-component-surface-hovered', ['--accent', '--secondary']],
  ['--interface-menu-component-surface-selected', ['--accent', '--primary']],
  ['--interface-menu-stroke', ['--border']],
  ['--interface-panel-surface', ['--card', '--background']],
  // ComfyUI uses this for the cursor/tool button's resting bg, so a prominent default
  // makes it look permanently "selected" — keep it a subtle elevation, not the accent.
  ['--interface-panel-selected-surface', ['--secondary', '--card']],
  ['--interface-stroke', ['--border']],
  ['--dialog-surface', ['--popover', '--card', '--background']],
  ['--modal-panel-background', ['--card', '--background']],
  ['--backdrop', ['--background']],
  ['--destructive-background', ['--destructive']],
  ['--destructive-background-hover', ['--destructive']],
  ['--node-component-surface-hovered', ['--accent', '--secondary']],
  ['--node-component-surface-selected', ['--accent', '--primary']],
  ['--node-divider', ['--border']],
  ['--node-stroke', ['--border']],
  ['--node-border', ['--border']],
  ['--node-stroke-selected', ['--ring', '--primary']],
  // The "blue" — PrimeVue primary palette (set at runtime) + ComfyUI's brand blue.
  ['--p-primary-400', ['--primary']],
  ['--p-primary-500', ['--primary']],
  ['--p-primary-600', ['--primary']],
  ['--brand-blue', ['--primary', '--accent']],
]

function selectTokenValue(map: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = map[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

function resolveThemeTokens(pack: ThemePack, mode: ThemeMode): Record<string, string> {
  const raw =
    (mode === 'dark' ? pack.tokens.dark : pack.tokens.light) ||
    pack.tokens.light ||
    pack.tokens.dark ||
    {}
  const withFallbacks: Record<string, string> = { ...raw }
  for (const [target, keys] of Object.entries(TOKEN_FALLBACKS)) {
    if (withFallbacks[target]) continue
    const r = selectTokenValue(withFallbacks, keys)
    if (r) withFallbacks[target] = r
  }
  const translated: Record<string, string> = {}
  for (const [target, keys] of COMFY_MAPPINGS) {
    const r = selectTokenValue(withFallbacks, keys)
    if (r) translated[target] = r
  }
  return { ...translated, ...withFallbacks } // core tokens win over their translations
}

// Parse a hex / rgb() color to [r,g,b] (0-255), or null for forms we can't read
// (var(), hsl, oklch, named) — caller then falls back to the pack's own foreground.
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
// Pick black or white text for a background by which gives more contrast — fixes
// unreadable white-on-light-accent (e.g. a yellow primary in a theme).
function readableText(bg: string): string | null {
  const rgb = parseRgb(bg)
  if (!rgb) return null
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#15151a'
}

// ComfyUI's node execution progress bar reads three hardcoded Tailwind theme vars
// (--color-interface-panel-job-progress-{primary,secondary,border}) that default to a
// fixed blue, so the bar ignores the active pack. Derive them from the pack's --primary
// (secondary = a translucent primary, matching ComfyUI's own faded-second-segment look).
// Spread these as DEFAULTS beneath the resolved tokens so a pack can still override any
// of the three by setting the var directly in its `tokens`.
function jobProgressDefaults(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const primary = selectTokenValue(map, ['--primary', '--accent'])
  if (primary) {
    out['--color-interface-panel-job-progress-primary'] = primary
    out['--color-interface-panel-job-progress-secondary'] =
      `color-mix(in srgb, ${primary} 35%, transparent)`
  }
  const fg = selectTokenValue(map, ['--foreground'])
  if (fg) out['--color-interface-panel-job-progress-border'] = fg
  return out
}

// Derive ZenKit's own --zen-* tokens from the resolved core tokens.
function zenDerived(map: Record<string, string>): Record<string, string> {
  const g = (...k: string[]) => selectTokenValue(map, k)
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
  // Compute a text color that actually contrasts the accent (a light/yellow accent
  // with a white foreground is unreadable). Fall back to the pack's own foreground
  // only when the accent isn't a parseable color.
  set(
    '--zen-accent-text',
    (accent && readableText(accent)) || g('--primary-foreground', '--background'),
  )
  set('--zen-radius', g('--radius'))
  return out
}

// --zen-* fallbacks to ComfyUI vars (the 'comfy' pack / before a pack loads).
const BASE_CSS = `:root{
  --zen-bg: var(--comfy-menu-bg, #1a1a1f);
  --zen-surface: var(--comfy-menu-secondary-bg, #202026);
  --zen-surface-2: color-mix(in srgb, var(--zen-surface) 78%, transparent);
  --zen-input: var(--comfy-input-bg, #15151a);
  --zen-text: var(--input-text, #e5e5ea);
  --zen-muted: var(--descrip-text, #9aa0aa);
  --zen-border: var(--border-color, #3a3a44);
  --zen-accent: var(--p-primary-color, #3b82f6);
  /* Text that sits ON the accent (primary buttons). PrimeVue computes a contrasting
     value per theme, so a light primary gets dark text instead of unreadable white. */
  --zen-accent-text: var(--p-primary-contrast-color, #fff);
  --zen-radius: var(--radius-md, 10px);
  --zen-glass: color-mix(in srgb, var(--zen-bg) 86%, transparent);
}`

// Themed scrollbars: ZenKit panels + sidebar-hosted content, plus any .zen-scroll element
// (covers teleported menus/popovers that live outside #zenkit-host). Thumb uses the accent.
const SCROLLBAR_CSS = `
#zenkit-host ::-webkit-scrollbar, .zenkit-sidebar-tab ::-webkit-scrollbar, .zen-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
#zenkit-host ::-webkit-scrollbar-track, .zenkit-sidebar-tab ::-webkit-scrollbar-track, .zen-scroll::-webkit-scrollbar-track { background: transparent; }
#zenkit-host ::-webkit-scrollbar-thumb, .zenkit-sidebar-tab ::-webkit-scrollbar-thumb, .zen-scroll::-webkit-scrollbar-thumb {
  background: var(--zen-scrollbar, color-mix(in srgb, var(--zen-text, #9aa0aa) 22%, transparent));
  border: 2px solid transparent; border-radius: var(--zen-radius, 8px); background-clip: padding-box;
}
#zenkit-host ::-webkit-scrollbar-thumb:hover, .zenkit-sidebar-tab ::-webkit-scrollbar-thumb:hover, .zen-scroll::-webkit-scrollbar-thumb:hover { background: var(--zen-scrollbar-hover, var(--zen-accent, #3b82f6)); background-clip: padding-box; }
#zenkit-host ::-webkit-scrollbar-corner, .zenkit-sidebar-tab ::-webkit-scrollbar-corner, .zen-scroll::-webkit-scrollbar-corner { background: transparent; }
/* Firefox only — setting these on Chromium would disable the webkit styling above. */
@supports not selector(::-webkit-scrollbar) {
  #zenkit-host *, .zenkit-sidebar-tab *, .zen-scroll { scrollbar-width: thin; scrollbar-color: var(--zen-scrollbar, color-mix(in srgb, var(--zen-text, #9aa0aa) 26%, transparent)) transparent; }
}`

// Direct !important rules on the ComfyUI 2.0 node DOM + chrome.
const BRIDGE_RULES = `
html[data-zen-theme-pack] { --zen-node-radius: var(--radius, 10px); --radius-2xl: var(--zen-node-radius); }
/* The Run button (.bg-primary-background, data-testid=queue-button) keeps ComfyUI's
   light text-base-foreground + text-white icon, unreadable on a light --primary
   (e.g. volt yellow). Tie dark text to the yellow bg class + the button itself
   (incl. the lucide icon, which colors via currentColor). */
html[data-zen-theme-pack] .bg-primary-background,
html[data-zen-theme-pack] .bg-primary-background *,
html[data-zen-theme-pack] [data-testid='queue-button'],
html[data-zen-theme-pack] [data-testid='queue-button'] * { color: var(--primary-foreground) !important; }
html[data-zen-theme-pack] .lg-node,
html[data-zen-theme-pack] .comfy-menu,
html[data-zen-theme-pack] .comfyui-body-top,
html[data-zen-theme-pack] .comfyui-body-bottom {
  background: var(--component-node-background, var(--card, var(--background))) !important;
  color: var(--component-node-foreground, var(--foreground)) !important;
  border-color: var(--component-node-border, var(--border)) !important;
}
html[data-zen-theme-pack] .lg-node { border-radius: var(--zen-node-radius) !important; }
html[data-zen-theme-pack] [data-testid="node-inner-wrapper"] { border-radius: var(--zen-node-radius) !important; }
html[data-zen-theme-pack] [data-testid="node-inner-wrapper"]::before { border-radius: inherit !important; }
html[data-zen-theme-pack] .lg-node > .pointer-events-none.absolute.border.border-solid.border-component-node-border { border-radius: var(--zen-node-radius) !important; }
html[data-zen-theme-pack] .lg-node-header {
  background: var(--node-component-header-surface, var(--component-node-background, var(--card))) !important;
  color: var(--node-component-slot-text, var(--foreground)) !important;
  border-color: var(--component-node-border, var(--border)) !important;
  border-radius: var(--zen-node-radius) var(--zen-node-radius) 0 0 !important;
}
html[data-zen-theme-pack] .lg-node > [data-testid^="node-body-"] {
  background: var(--component-node-background, var(--card, var(--background))) !important;
  border-radius: 0 0 var(--zen-node-radius) var(--zen-node-radius) !important;
}
/* Node bottom-edge elements hardcode their bottom radius (the status/error banner uses
   rounded-b-[20px] + bg-destructive-background; the node body uses rounded-b-2xl, which
   Tailwind tends to inline so the --radius-2xl override above doesn't catch it). Pin all of
   them to our node radius so they line up with the node corners instead of a fixed value. */
html[data-zen-theme-pack] .lg-node .rounded-b-2xl,
html[data-zen-theme-pack] [data-testid="node-inner-wrapper"] .rounded-b-2xl,
html[data-zen-theme-pack] .lg-node .rounded-b-\\[20px\\],
html[data-zen-theme-pack] [data-testid="node-inner-wrapper"] .rounded-b-\\[20px\\],
html[data-zen-theme-pack] .lg-node .bg-destructive-background,
html[data-zen-theme-pack] [data-testid="node-inner-wrapper"] .bg-destructive-background {
  border-bottom-left-radius: var(--zen-node-radius) !important;
  border-bottom-right-radius: var(--zen-node-radius) !important;
}
/* A folded/collapsed node is header-only, so the header's bottom must round too (the rule
   above rounds just the top, for when a body sits below). Match the collapsed class/attr,
   or any node that has no body rendered. */
html[data-zen-theme-pack] .lg-node.collapsed .lg-node-header,
html[data-zen-theme-pack] .lg-node[data-collapsed="true"] .lg-node-header,
html[data-zen-theme-pack] .lg-node:not(:has([data-testid^="node-body-"])) .lg-node-header {
  border-radius: var(--zen-node-radius) !important;
}
html[data-zen-theme-pack] [data-testid="node-state-outline-overlay"] {
  border-color: var(--primary-background, var(--primary)) !important;
  border-radius: calc(var(--zen-node-radius) + 3px) !important;
}
html[data-zen-theme-pack] .text-node-component-slot-text,
html[data-zen-theme-pack] .node-title,
html[data-zen-theme-pack] .comfy-menu button,
html[data-zen-theme-pack] .comfy-menu label {
  color: var(--node-component-slot-text, var(--foreground)) !important;
}
html[data-zen-theme-pack] .p-button.p-button-primary,
html[data-zen-theme-pack] .p-splitbutton .p-button-primary {
  background: var(--p-button-primary-background, var(--primary-background, var(--primary))) !important;
  border-color: var(--p-button-primary-border-color, var(--primary-background, var(--primary))) !important;
  color: var(--p-button-primary-color, var(--primary-foreground, var(--foreground))) !important;
}
html[data-zen-theme-pack] .p-button.p-button-primary:hover,
html[data-zen-theme-pack] .p-splitbutton .p-button-primary:hover {
  background: var(--p-button-primary-hover-background, var(--primary-background-hover, var(--primary))) !important;
  border-color: var(--p-button-primary-hover-border-color, var(--primary-background-hover, var(--primary))) !important;
}
html[data-zen-theme-pack] .p-togglebutton,
html[data-zen-theme-pack] .p-togglebutton .p-togglebutton-content { color: var(--p-togglebutton-color, var(--foreground)) !important; }
html[data-zen-theme-pack] .p-togglebutton.p-togglebutton-checked,
html[data-zen-theme-pack] .p-togglebutton.p-togglebutton-checked:hover {
  background: var(--p-togglebutton-checked-background, var(--primary-background-hover, var(--accent, var(--primary)))) !important;
  border-color: var(--p-togglebutton-checked-border-color, var(--primary-background-hover, var(--accent, var(--primary)))) !important;
}
/* The checked toggle sits on the accent — its label AND icon must contrast THAT, not the
   page bg. --accent-foreground is the pack's contrast colour for the accent; force it on
   every descendant so the icon (e.g. the cursor-mode glyph) isn't left white. */
html[data-zen-theme-pack] .p-togglebutton.p-togglebutton-checked,
html[data-zen-theme-pack] .p-togglebutton.p-togglebutton-checked * {
  color: var(--accent-foreground, var(--primary-foreground, var(--foreground))) !important;
  fill: var(--accent-foreground, var(--primary-foreground, var(--foreground))) !important;
}
html[data-zen-theme-pack] .p-inputtext,
html[data-zen-theme-pack] .p-select,
html[data-zen-theme-pack] .p-inputnumber-input {
  background: var(--p-form-field-background, var(--input-surface, var(--input))) !important;
  border-color: var(--p-form-field-border-color, var(--border)) !important;
  color: var(--p-form-field-color, var(--foreground)) !important;
}
/* Nodes 2.0 inline widget controls (combo/select triggers, number & text inputs, …) don't
   carry their own text colour the way the multiline <textarea> does. The textarea has
   text-component-node-foreground so it stays readable; the others inherit — and ComfyUI's
   widget components paint the value with a light colour meant for dark nodes (not
   !important). On a LIGHT theme (e.g. Cute Hearts) that renders the value ~white on the
   light --component-node-widget-background and it's unreadable. Pin every widget control
   (and its value text) to the SAME readable node foreground the textarea already uses.
   Only the control/value is targeted — field <label>s keep their muted colour, so the
   name/value hierarchy is preserved. [data-testid^="widget-"] and the select-trigger
   combobox are node-widget-specific (never page chrome); the native input/select rules are
   scoped to the node so chrome inputs elsewhere are untouched. */
html[data-zen-theme-pack] [data-testid^="widget-"],
html[data-zen-theme-pack] [data-testid^="widget-"] *,
html[data-zen-theme-pack] [data-testid$="-trigger"][role="combobox"],
html[data-zen-theme-pack] [data-testid$="-trigger"][role="combobox"] *,
html[data-zen-theme-pack] .lg-node input,
html[data-zen-theme-pack] .lg-node select,
html[data-zen-theme-pack] [data-testid="node-inner-wrapper"] input,
html[data-zen-theme-pack] [data-testid="node-inner-wrapper"] select {
  color: var(--component-node-foreground, var(--foreground)) !important;
}
html[data-zen-theme-pack] .litegraph-minimap { border-radius: var(--radius, 10px) !important; overflow: hidden !important; }
/* PrimeVue / ComfyUI overlay menus (tiered/context/command menus, dropdown + autocomplete
   popovers) keep their own fixed border-radius, so they look "weirdly rounded" against a
   theme — pin them to the theme radius. Also drive PrimeVue's radius scale so anything that
   reads the tokens (rather than these classes) follows along too. */
html[data-zen-theme-pack] {
  --p-border-radius-md: var(--zen-radius, 10px);
  --p-border-radius-lg: var(--zen-radius, 10px);
  --p-border-radius-xl: var(--zen-radius, 10px);
}
html[data-zen-theme-pack] .p-tieredmenu,
html[data-zen-theme-pack] .p-tieredmenu-overlay,
html[data-zen-theme-pack] .p-menu,
html[data-zen-theme-pack] .p-menu-overlay,
html[data-zen-theme-pack] .p-contextmenu,
html[data-zen-theme-pack] .p-popover,
html[data-zen-theme-pack] .p-overlaypanel,
html[data-zen-theme-pack] .p-select-overlay,
html[data-zen-theme-pack] .p-autocomplete-overlay,
html[data-zen-theme-pack] .p-multiselect-overlay,
html[data-zen-theme-pack] .comfy-command-menu { border-radius: var(--zen-radius, 10px) !important; }
/* The actionbar's inline run-progress bar uses fixed Tailwind rounding (rounded-[7px]/[5px]/
   -md) that ignores the theme — pin it (and its fill) to the theme radius. */
html[data-zen-theme-pack] [data-testid="queue-inline-progress"],
html[data-zen-theme-pack] [data-testid="queue-inline-progress"] * { border-radius: var(--zen-radius, 7px) !important; }
/* ComfyUI tree rows (node/model library) hover to a Tailwind bg-comfy-input colour, which
   doesn't reliably contrast the row text across themes -> the row "goes dark" and is
   unreadable. Replace it with a subtle text-tint that always contrasts (and keep the row's
   own readable text colour). */
html[data-zen-theme-pack] [class~="group/tree-node"]:hover,
html[data-zen-theme-pack] .p-tree-node-content:hover,
html[data-zen-theme-pack] .p-tree-node-selectable:not(.p-tree-node-selected):hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent) !important;
  color: var(--zen-text, var(--foreground)) !important;
}
/* Selected sidebar tab: its surface is a SUBTLE elevation (--interface-panel-selected-surface
   = --secondary), not the accent — so forcing primary-foreground made the icon go dark and
   unreadable. Colour the selected icon+label with the ACCENT instead: a clear, readable
   highlight on the subtle surface (the icons are mask glyphs that paint with currentColor).
   EXCLUDE the count badge (.sidebar-icon-badge — e.g. the open-workflows tab) so it keeps its
   own bg/text pairing; tinting it primary made the number vanish into its primary background. */
html[data-zen-theme-pack] .side-bar-button-selected,
html[data-zen-theme-pack] .side-bar-button-selected *:not(.sidebar-icon-badge):not(.sidebar-icon-badge *) {
  color: var(--primary, var(--accent, var(--foreground))) !important;
}
/* A genuinely accent-FILLED highlight (PrimeVue p-highlight) does need contrast text. */
html[data-zen-theme-pack] .side-tool-bar-container .p-button.p-highlight,
html[data-zen-theme-pack] .side-tool-bar-container .p-button.p-highlight * {
  color: var(--primary-foreground, var(--foreground)) !important;
}
/* Canvas zoom/fit controls (reparented into the Zen taskbar) keep ComfyUI's white
   icon/text — unreadable on a light taskbar. Use the taskbar's own text colour. */
html[data-zen-theme-pack] .zen-canvasctl,
html[data-zen-theme-pack] .zen-canvasctl * { color: var(--zen-text, var(--foreground)) !important; }
/* …and strip the button backgrounds inside them — the theme's button/toggle highlight
   makes the cursor-mode control look permanently "on". Leave just the icons. */
html[data-zen-theme-pack] .zen-canvasctl button,
html[data-zen-theme-pack] .zen-canvasctl .p-button,
html[data-zen-theme-pack] .zen-canvasctl .p-togglebutton,
html[data-zen-theme-pack] .zen-canvasctl .bg-interface-panel-selected-surface {
  background: transparent !important; border-color: transparent !important; box-shadow: none !important;
}
/* The drag-select marquee (Nodes 2.0) is a Tailwind blue box (border-blue-400 + bg-blue-500/20).
   Recolour it to the accent + round the corners. */
html[data-zen-theme-pack] .z-9999.border-blue-400 {
  border-color: var(--zen-accent, var(--primary, #3b82f6)) !important;
  background: color-mix(in srgb, var(--zen-accent, var(--primary, #3b82f6)) 18%, transparent) !important;
  border-radius: var(--radius, 8px) !important;
}
/* Minimap viewport indicator (the "view cone") is white by default — use the accent. */
html[data-zen-theme-pack] .minimap-viewport {
  border-color: var(--zen-accent, var(--primary, #3b82f6)) !important;
  outline-color: var(--zen-accent, var(--primary, #3b82f6)) !important;
  background: color-mix(in srgb, var(--zen-accent, var(--primary, #3b82f6)) 14%, transparent) !important;
}
`

/** All registered pack ids, 'comfy' first. */
export function themePackIds(): string[] {
  return ['comfy', ...registeredPacks().map((p) => p.id)]
}
const LS_PACK = 'zenkit.theme.pack'
const LS_MODE = 'zenkit.theme.mode'
const ATTR = 'data-zen-theme-pack'

let currentPack = 'comfy'
let currentMode: ThemeMode = 'dark'
const listeners = new Set<(pack: string) => void>()

const roots = (): HTMLElement[] => [document.documentElement, document.body]

function applyMode() {
  document.body.classList.toggle('dark-theme', currentMode === 'dark')
}
function persist() {
  try {
    localStorage.setItem(LS_PACK, currentPack)
    localStorage.setItem(LS_MODE, currentMode)
  } catch {
    /* ignore */
  }
}
function notify() {
  listeners.forEach((cb) => {
    try {
      cb(currentPack)
    } catch (e) {
      console.error('[ZenKit] theme listener threw', e)
    }
  })
}

// Pack tokens go in ONE <style> with !important (beats ComfyUI's inline vars). We
// never write ComfyUI's vars inline, so emptying this style (the 'comfy' pack)
// restores them untouched — nothing is destroyed or "left behind", and each apply
// fully replaces the rule rather than diffing. Target BOTH html and body: ComfyUI
// sets vars inline on <body>, and custom props resolve from the nearest ancestor —
// so a body-level definition would shadow an html-only one for descendant nodes.
function tokenCss(map: Record<string, string>): string {
  let body = ''
  for (const k of Object.keys(map)) body += `${k}:${map[k]} !important;`
  return `html[${ATTR}],body[${ATTR}]{${body}}`
}

// ComfyUI's --radius-* scale is fixed values (not derived from --radius), so override
// the whole scale relative to the pack's --radius — a 0-radius theme then goes square
// everywhere (buttons, inputs, cards, dialogs), not just the nodes.
function radiusScale(r: string): Record<string, string> {
  return {
    '--radius': r,
    '--radius-sm': `calc(${r} * 0.5)`,
    '--radius-md': `calc(${r} * 0.75)`,
    '--radius-lg': r,
    '--radius-xl': `calc(${r} * 1.5)`,
    '--radius-2xl': `calc(${r} * 2)`,
    '--radius-3xl': `calc(${r} * 3)`,
    '--radius-4xl': `calc(${r} * 4)`,
    '--radius-5xl': `calc(${r} * 5)`,
  }
}

function applyTheme() {
  const pack = currentPack === 'comfy' ? null : getPack(currentPack)
  if (!pack) {
    ensureStyle('zenkit-theme-tokens', '') // no overrides; ComfyUI owns its vars
    ensureStyle('zenkit-theme-css', '') // and no pack custom CSS
    for (const el of roots()) el.removeAttribute(ATTR)
    applyMode()
    notify()
    return
  }
  const resolved = resolveThemeTokens(pack, currentMode)
  const r = resolved['--radius']
  ensureStyle(
    'zenkit-theme-tokens',
    tokenCss({
      ...jobProgressDefaults(resolved),
      ...resolved,
      ...zenDerived(resolved),
      ...(r ? radiusScale(r) : {}),
    }),
  )
  // The active pack's custom CSS (header notches, etc.), injected verbatim AFTER
  // the tokens so it cascades over them, and cleared the moment another pack (or a
  // css-less one) takes over — so a theme's CSS never leaks past its own pack.
  ensureStyle('zenkit-theme-css', pack.css || '')
  // Tag the roots with the active pack id. Existing selectors only test for the
  // attribute's PRESENCE (`html[data-zen-theme-pack] …`), so the value is free for
  // theme CSS to scope on (`html[data-zen-theme-pack="mecha"] …`) when it wants to.
  for (const el of roots()) el.setAttribute(ATTR, currentPack)
  applyMode()
  notify()
}

export const theme = {
  tokens: ZEN_TOKENS,
  init() {
    ensureStyle('zenkit-theme-base', BASE_CSS)
    ensureStyle('zenkit-theme-bridge', BRIDGE_RULES)
    ensureStyle('zenkit-scrollbars', SCROLLBAR_CSS)
    let sp: string | null = null
    let sm: string | null = null
    try {
      sp = localStorage.getItem(LS_PACK)
      sm = localStorage.getItem(LS_MODE)
    } catch {
      /* ignore */
    }
    currentMode =
      sm === 'light' || sm === 'dark'
        ? sm
        : document.body.classList.contains('dark-theme')
          ? 'dark'
          : 'light'
    currentPack = sp && (sp === 'comfy' || !!getPack(sp)) ? sp : 'comfy'
    // A persisted mode the restored pack doesn't support (e.g. saved 'light' + a dark-only
    // pack) must be clamped, same as setPack — keep the .dark-theme class and tokens in sync.
    const modes = this.packModes(currentPack)
    if (modes.length && !modes.includes(currentMode)) currentMode = modes[0]!
    applyTheme()
  },
  packs(): string[] {
    return themePackIds()
  },
  packLabel(id: string): string {
    return id === 'comfy' ? 'comfy' : getPack(id)?.name || id
  },
  // A single representative color for a pack (for menu swatches): its primary, falling back
  // through accent/background. Uses the active mode's token set, else whichever the pack has.
  // 'comfy' resolves to ComfyUI's live primary so its dot tracks the host theme.
  packSwatch(id: string): string {
    if (id === 'comfy') return 'var(--p-primary-color, #3b82f6)'
    const p = getPack(id)
    if (!p) return 'var(--zen-accent, #3b82f6)'
    const set =
      (currentMode === 'dark' ? p.tokens.dark : p.tokens.light) ||
      p.tokens.light ||
      p.tokens.dark ||
      {}
    return (
      set['--primary'] ||
      set['--accent'] ||
      set['--background'] ||
      set['--card'] ||
      'var(--zen-accent, #3b82f6)'
    )
  },
  // A pack's corner radius (for the menu swatch's rounding, so the dot also previews the
  // theme's squareness/roundness). 'comfy' → a plain circle. A small dot caps large radii
  // to a circle automatically (border-radius > half the box).
  packRadius(id: string): string {
    if (id === 'comfy') return '50%'
    const p = getPack(id)
    if (!p) return '50%'
    const set =
      (currentMode === 'dark' ? p.tokens.dark : p.tokens.light) ||
      p.tokens.light ||
      p.tokens.dark ||
      {}
    return set['--radius'] || '50%'
  },
  current() {
    return currentPack
  },
  setPack(id: string) {
    if (id !== 'comfy' && !getPack(id)) return
    if (id === currentPack) return // no-op; also breaks settings<->theme sync loops
    currentPack = id
    // Clamp the mode to one the new pack supports: switching to a dark-only pack while in
    // light mode must flip to dark, or applyMode() would leave .dark-theme off while the
    // dark tokens are applied (mismatched chrome). Mirrors applyPack() in @nynxz/zenkit-theme.
    const modes = this.packModes(id)
    if (modes.length && !modes.includes(currentMode)) currentMode = modes[0]!
    persist()
    applyTheme()
  },
  currentMode(): ThemeMode {
    return currentMode
  },
  setMode(mode: ThemeMode) {
    if (mode === currentMode) return // no-op; also breaks settings<->theme sync loops
    currentMode = mode
    persist()
    applyTheme()
  },
  onChange(cb: (pack: string) => void) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  packModes(id: string): ThemeMode[] {
    return id === 'comfy' ? ['light', 'dark'] : packModesOf(id)
  },
  registerPack(pack: ThemePack): boolean {
    const stored = registerThemePack(pack)
    if (stored && stored.id === currentPack) applyTheme()
    return !!stored
  },
}
