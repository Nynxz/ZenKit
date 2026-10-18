// Appearance controls, as NATIVE ComfyUI settings — same reasoning as backgroundSettings.ts.
//
// NB: every `category` path must be UNIQUE. ComfyUI builds the settings tree by the full path and
// assigns `node.data = setting` at the leaf, so two settings sharing a path collapse into one and
// only the last registered is rendered — silently. The third element is a key, not a group label;
// the user reads `name`, and the second element is what groups them.
import { app } from '@comfy/app'
import { theme } from '@nynxz/zenkit-core'

const RESTYLE_ID = 'zenkit.appearance.restyleComfy'

/** The top-bar Zen Settings button's tooltip, which ComfyUI also uses as its aria-label — the
 *  only stable handle on a button ComfyUI renders for us. */
export const SETTINGS_BUTTON_TOOLTIP = 'ZenKit — Zen Settings'

const HIDE_BUTTON_STYLE_ID = 'zenkit-hide-settings-button'

// Styled away rather than unregistered: ComfyUI reads `actionBarButtons` once, at registration.
function showSettingsButton(show: boolean): void {
  document.getElementById(HIDE_BUTTON_STYLE_ID)?.remove()
  if (show) return
  const style = document.createElement('style')
  style.id = HIDE_BUTTON_STYLE_ID
  style.textContent = `button[aria-label="${SETTINGS_BUTTON_TOOLTIP}"] { display: none !important; }`
  document.head.appendChild(style)
}

export function registerAppearanceSettings(): void {
  app.registerExtension({
    name: 'zenkit.appearance.settings',
    settings: [
      {
        id: RESTYLE_ID,
        name: 'Restyle ComfyUI',
        category: ['ZenKit', 'Appearance', 'Restyle ComfyUI'],
        type: 'boolean',
        defaultValue: true,
        tooltip:
          "Let ZenKit restyle ComfyUI's own interface: theme packs recolour and reshape it, and " +
          "the canvas controls move into the taskbar. Off leaves ComfyUI as it ships; ZenKit's " +
          'taskbar and panels still follow the theme.',
        onChange(value: boolean) {
          theme.setComfyRestyle(value !== false)
        },
      },
      {
        id: 'zenkit.appearance.settingsButton',
        name: 'Show the Zen Settings top bar button',
        category: ['ZenKit', 'Appearance', 'Settings button'],
        type: 'boolean',
        defaultValue: true,
        tooltip:
          'Show the Zen Settings button in the top bar. Zen Settings stays in the Start menu and ' +
          'the command palette either way.',
        onChange(value: boolean) {
          showSettingsButton(value !== false)
        },
      },
    ],
  } as never)
}
