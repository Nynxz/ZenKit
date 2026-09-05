import { app } from '@comfy/app'
import { registerBackgroundSettings } from './backgroundSettings'
import {
  fetchThemes,
  installZenKit,
  installZenKitSecondary,
  openZenSettings,
  toggleZenPanels,
} from '@nynxz/zenkit-core'

// Theme packs are discovered at RUNTIME from the server (GET /zenkit/themes, served by
// zenkit_themes_api.py, which scans themes/<id>/theme.json on disk and inlines any css
// file refs). No longer bundled at build time — drop a theme JSON in and reload, no
// rebuild. We fetch before installZenKit so the taskbar/settings theme lists (read once
// at mount) are already populated. An offline/missing route resolves to [] → just the
// built-in 'comfy' pack.

// Detached-panel window (?zen-panel=…, see detach.ts): drop a full-screen cover the
// instant our script loads so the host ComfyUI's boot is hidden behind a loading screen
// until the detached panel mounts over it. installZenKitSecondary removes the cover.
const detachedPanel =
  typeof location !== 'undefined' ? new URLSearchParams(location.search).get('zen-panel') : null
if (detachedPanel) {
  const cover = document.createElement('div')
  cover.id = 'zen-secondary-cover'
  cover.style.cssText =
    'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
    'background:#1a1a1f;color:#9aa0aa;font:13px system-ui,sans-serif;'
  cover.textContent = 'Loading…'
  ;(document.body || document.documentElement).appendChild(cover)
}

// The background's controls, as native ComfyUI settings. Registered as its own extension (and
// BEFORE the runtime install) so ComfyUI has them in hand when it replays stored values on load —
// including in detached-panel mode, where the runtime install is skipped entirely.
registerBackgroundSettings()

app.registerExtension({
  name: 'nynxz.zenkit',
  async setup() {
    const themes = await fetchThemes() // runtime theme discovery (GET /zenkit/themes)
    // Detached-panel mode: mount just that one panel fullscreen, no taskbar/host/background.
    if (detachedPanel) {
      installZenKitSecondary(detachedPanel, { themes })
      return
    }
    installZenKit({ themes })
  },
  // Topbar button → Zen Settings (the Start menu is the launcher/theme hub).
  actionBarButtons: [
    {
      icon: 'mdi mdi-tune-variant',
      tooltip: 'ZenKit — Zen Settings',
      onClick: openZenSettings,
    },
  ],
  commands: [
    {
      id: 'ZenKit.openSettings',
      label: 'ZenKit: Open Zen Settings',
      function: () => openZenSettings(),
    },
    {
      id: 'ZenKit.togglePanels',
      label: 'ZenKit: Hide / show all panels',
      function: () => toggleZenPanels(),
    },
    // Native logo-menu entry for the theme switcher. ComfyUI renders + state-manages this item
    // (correct hover/highlight); @nynxz/zenkit-core wires a ZenKit popup to it on hover. Clicking the
    // label opens the full picker (Zen Settings) as the fallback.
    {
      id: 'ZenKit.Themes',
      label: 'ZenKit Themes',
      icon: 'mdi mdi-palette-outline',
      function: () => openZenSettings(),
    },
  ],
  // Place "ZenKit Themes" at the top level of the logo (☰) menu, beside ComfyUI's own "Theme".
  menuCommands: [{ path: [], commands: ['ZenKit.Themes'] }],
})
