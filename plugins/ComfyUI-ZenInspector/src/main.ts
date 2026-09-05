import { app } from '@comfy/app'
import { createApp } from 'vue'
// The pack version, read from package.json so it cannot drift from what ships.
import { version } from '../package.json'
import { registerZenPlugin, type ZenPanelDef } from '@nynxz/zenkit-client'
import Inspector from '@/Inspector.vue'

// Zen Inspector — the debug panel for the whole install: every nodepack and frontend
// extension ComfyUI loaded, what each one actually registered, and where the sources
// disagree. ZenKit's own ledger (window.ZenKit.plugins) is folded in as one more layer, so
// this plugin shows up in its own list — the cleanest dogfood there is.
const PANEL: ZenPanelDef = {
  id: 'inspector', // short id → auto-prefixed to 'zeninspector:inspector'
  title: 'Zen Inspector',
  icon: 'mdi mdi-magnify-scan',
  // Sized for the master–detail split: the pack list is a fixed 232px, so the detail pane
  // needs the rest to keep node rows on one line.
  width: 940,
  height: 680,
  minWidth: 560,
  minHeight: 380,
  render(el) {
    const a = createApp(Inspector)
    a.mount(el)
    return () => a.unmount()
  },
}

app.registerExtension({
  name: 'nynxz.zeninspector',
  setup() {
    void registerZenPlugin({
      id: 'zeninspector',
      plugin: 'Zen Inspector',
      version,
      panels: [PANEL],
    })
  },
} as never)
