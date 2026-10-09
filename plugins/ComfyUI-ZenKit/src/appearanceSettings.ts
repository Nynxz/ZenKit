// Appearance controls, as NATIVE ComfyUI settings — same reasoning as backgroundSettings.ts.
//
// NB: every `category` path must be UNIQUE. ComfyUI builds the settings tree by the full path and
// assigns `node.data = setting` at the leaf, so two settings sharing a path collapse into one and
// only the last registered is rendered — silently. The third element is a key, not a group label;
// the user reads `name`, and the second element is what groups them.
import { app } from '@comfy/app'
import { theme } from '@nynxz/zenkit-core'

const RESTYLE_ID = 'zenkit.appearance.restyleComfy'

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
    ],
  } as never)
}
