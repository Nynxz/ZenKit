// The canvas background's controls, as NATIVE ComfyUI settings.
//
// They live here rather than in the Zen Settings panel on purpose. ComfyUI's own settings dialog
// persists them (comfy.settings.json), fires `onChange` on load and on every edit, and gives them
// a searchable home next to every other canvas preference — so the background behaves like part of
// ComfyUI rather than a thing hidden behind a ZenKit panel. It also means the settings work before
// any Zen panel is opened.
//
// This is registered by the ComfyUI-ZenKit plugin, not by `@nynxz/zenkit-core`, so that core stays free
// of ComfyUI's settings API and a plugin embedding core doesn't get a second copy of these.
//
// The setters in `@nynxz/zenkit-core` are idempotent and safe to call before the graph canvas exists —
// the background host waits for it — so the ordering here doesn't matter.
import { app } from '@comfy/app'
import {
  setBackgroundBlobFlow,
  setBackgroundEnabled,
  setBackgroundFollow,
  setBackgroundFollowSpeed,
} from '@nynxz/zenkit-core'

const ENABLED_ID = 'zenkit.background.enabled'
const FOLLOW_ID = 'zenkit.background.follow'
const FOLLOW_SPEED_ID = 'zenkit.background.followSpeed'
const BLOB_FLOW_ID = 'zenkit.background.blobFlow'

export function registerBackgroundSettings(): void {
  app.registerExtension({
    name: 'zenkit.background.settings',
    settings: [
      {
        id: ENABLED_ID,
        name: 'Graph background',
        category: ['ZenKit', 'Canvas', 'Graph background'],
        type: 'boolean',
        defaultValue: false,
        tooltip:
          'A WebGL grid of glowing dots behind the node graph that reacts to your cursor and ' +
          'follows your theme colours. Off by default.',
        onChange(value: boolean) {
          setBackgroundEnabled(!!value)
        },
      },
      {
        id: FOLLOW_ID,
        name: 'Cursor follow',
        category: ['ZenKit', 'Canvas', 'Cursor follow'],
        type: 'combo',
        defaultValue: 'snap',
        options: [
          { text: 'Snap (1:1)', value: 'snap' },
          { text: 'Follow (eased)', value: 'follow' },
          { text: 'Blob (droplet)', value: 'blob' },
        ],
        tooltip:
          'How the glow tracks your cursor. Snap sits exactly on it; Follow eases in behind it; ' +
          'Blob trails a tapered droplet that curves along the path you draw, like water being dragged.',
        onChange(value: string) {
          setBackgroundFollow(String(value))
        },
      },
      {
        id: FOLLOW_SPEED_ID,
        name: 'Follow speed',
        category: ['ZenKit', 'Canvas', 'Follow speed'],
        type: 'slider',
        defaultValue: 45,
        attrs: { min: 1, max: 100, step: 1 },
        tooltip:
          'How quickly the glow catches up to your cursor. Higher is snappier. No effect in Snap mode.',
        onChange(value: number) {
          setBackgroundFollowSpeed(Number(value))
        },
      },
      {
        id: BLOB_FLOW_ID,
        name: 'Blob flow',
        category: ['ZenKit', 'Canvas', 'Blob flow'],
        type: 'slider',
        defaultValue: 55,
        attrs: { min: 0, max: 100, step: 1 },
        tooltip:
          'Length and pointiness of the Blob droplet tail. Low = a short rounded blob; high = a ' +
          'long tapered comet tail. Only used in Blob mode.',
        onChange(value: number) {
          setBackgroundBlobFlow(Number(value))
        },
      },
    ],
    // Fallback: some ComfyUI builds don't fire `onChange` for stored values on load, which would
    // leave the background at its defaults while the dialog showed the user's choices. The setters
    // are idempotent, so applying them again here is harmless.
    async setup() {
      try {
        const s = app.extensionManager?.setting
        const on = s?.get(ENABLED_ID)
        if (on !== undefined) setBackgroundEnabled(!!on)
        const follow = s?.get(FOLLOW_ID)
        if (follow !== undefined) setBackgroundFollow(String(follow))
        const speed = s?.get(FOLLOW_SPEED_ID)
        if (speed !== undefined) setBackgroundFollowSpeed(Number(speed))
        const flow = s?.get(BLOB_FLOW_ID)
        if (flow !== undefined) setBackgroundBlobFlow(Number(flow))
      } catch {
        // The settings API shape varies between ComfyUI versions; onChange covers the common path.
      }
    },
  } as never)
}
