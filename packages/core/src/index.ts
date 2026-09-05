// @nynxz/zenkit-core — the ZenKit runtime; installs `window.ZenKit`, the taskbar/host
// overlay, panels, and the theme bridge.

export {
  installZenKit,
  installZenKitSecondary,
  openZenSettings,
  toggleZenPanels,
  ZENKIT_VERSION,
  type InstallOptions,
} from './install'
// The canvas background. `backgrounds` is the registry plugins add their own to; the setters are
// what a host's settings UI calls (see ComfyUI-ZenKit's backgroundSettings.ts).
export {
  backgrounds,
  backgroundEnabled,
  setBackgroundEnabled,
  setBackgroundFollow,
  setBackgroundFollowSpeed,
  setBackgroundBlobFlow,
  startBackground,
} from './background'
export { theme, themePackIds, ZEN_TOKENS } from './theme'
export { fetchThemes, DEFAULT_THEMES_URL } from './themeLoader'
export type { ThemeMode } from './theme'
export type * from './types'
