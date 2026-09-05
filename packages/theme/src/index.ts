// @nynxz/zenkit-theme — the ZenKit token system: an engine + registry for theme packs.
// Packs are data (JSON), loaded and registered at runtime — none are baked in.
// Pure: writes CSS custom properties; no ComfyUI coupling (the host bridge lives
// in @nynxz/zenkit-core).

export { THEME_TOKENS, type ThemeToken } from './tokens'
export { BASE_TOKENS } from './base'
export { type ThemePack, parsePack } from './pack'
export { registerPack, registerPacks, packs, getPack, clearPacks } from './registry'
export { packModes, resolveTokens, applyPack, type ApplyOptions } from './apply'
// The --zen-* component alias layer (what @nynxz/zenkit-ui reads), with the readable
// on-accent text fix. Lets the components be themed outside the ComfyUI runtime.
export { readableText, zenAliases } from './zen'
