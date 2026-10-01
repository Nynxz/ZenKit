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
  backgroundEffectList,
  backgroundEffectIntensity,
  backgroundEffects,
  backgroundFinish,
  backgroundImage,
  backgroundKind,
  setBackgroundEnabled,
  setBackgroundEffectIntensity,
  setBackgroundEffects,
  setBackgroundFinish,
  setBackgroundFollow,
  setBackgroundFollowSpeed,
  setBackgroundBlobFlow,
  setBackgroundImage,
  setBackgroundKind,
  startBackground,
} from './background'
// Hold ComfyUI's sidebar at an exact px width so a ZenKit dock (or a window resize) can't
// shrink it — ComfyUI sizes it as a percentage of the graph area. See sidebarPin.ts.
export { startSidebarPin, setSidebarPin, sidebarPinEnabled, resetSidebarPin } from './sidebarPin'
export { theme, themePackIds, ZEN_TOKENS } from './theme'
export { fetchThemes, DEFAULT_THEMES_URL } from './themeLoader'
export type { ThemeMode } from './theme'
export type * from './types'
