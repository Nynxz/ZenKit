import { app } from '@comfy/app'
// The pack version, read from package.json so it cannot drift from what ships.
import { version } from '../package.json'
// The family tile from docs/assets/render/brand.mjs; the build inlines it as a data URI.
import logo from './logo.svg'
import { mountVue, registerZenPlugin, type ZenPanelDef } from '@nynxz/zenkit-client'
import Gallery from '@/Gallery.vue'
import JobLab from '@/JobLab.vue'

// Zen Example — a reference plugin: each ZenKit feature it demonstrates is one panel.
const JOB_LAB: ZenPanelDef = {
  id: 'jobs', // short id → auto-prefixed to 'zenexample:jobs'
  title: 'Job Lab',
  icon: 'mdi mdi-progress-wrench',
  width: 440,
  height: 360,
  minWidth: 340,
  minHeight: 260,
  render: mountVue(JobLab),
}

const GALLERY: ZenPanelDef = {
  id: 'gallery', // → 'zenexample:gallery'
  title: 'Component gallery',
  icon: 'mdi mdi-view-grid-outline',
  width: 980,
  height: 760,
  minWidth: 420,
  minHeight: 320,
  render: mountVue(Gallery),
}

app.registerExtension({
  name: 'nynxz.zenexample',
  setup() {
    void registerZenPlugin({
      id: 'zenexample',
      plugin: 'Zen Example',
      version,
      logo,
      description:
        'A reference ZenKit plugin: its Job Lab starts test jobs of every kind, and its gallery shows every UI component.',
      panels: [JOB_LAB, GALLERY],
    })
  },
} as never)
