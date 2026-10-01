// Appearance controls, as NATIVE ComfyUI settings — same reasoning as backgroundSettings.ts.
// Category paths must be unique (see layoutSettings.ts).
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
