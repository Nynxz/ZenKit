// Layout controls, as NATIVE ComfyUI settings — same reasoning as backgroundSettings.ts: they
// belong next to ComfyUI's own preferences, they persist in comfy.settings.json, and they work
// before any Zen panel is opened.
//
// NB: every `category` path must be UNIQUE. ComfyUI builds the settings tree by the full path and
// assigns `node.data = setting` at the leaf, so two settings sharing a path collapse into one and
// only the last registered is rendered — silently. The third element is a key, not a group label;
// the user reads `name`, and the second element is what groups them.
import { app } from '@comfy/app'
import { setSidebarPin } from '@nynxz/zenkit-core'

const PIN_ID = 'zenkit.layout.pinSidebarWidth'

export function registerLayoutSettings(): void {
  app.registerExtension({
    name: 'zenkit.layout.settings',
    settings: [
      {
        id: PIN_ID,
        name: 'Pin sidebar width',
        category: ['ZenKit', 'Layout', 'Pin sidebar width'],
        type: 'boolean',
        defaultValue: true,
        tooltip:
          'ComfyUI sizes its sidebar as a percentage of the graph area, so anything that takes ' +
          'width out of that area — a docked ZenKit panel, or just a narrower window — shrinks ' +
          'the sidebar with it. This holds the sidebar at the pixel width you dragged it to. ' +
          'Dragging the divider still works and sets the new width.',
        onChange(value: boolean) {
          setSidebarPin(!!value)
        },
      },
    ],
    async setup() {
      try {
        const v = app.extensionManager?.setting?.get(PIN_ID)
        if (v !== undefined) setSidebarPin(!!v)
      } catch {
        // The settings API shape varies between ComfyUI versions; onChange covers the common path.
      }
    },
  } as never)
}
