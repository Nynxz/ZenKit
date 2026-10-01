import { app } from '@comfy/app'
// The pack version, read from package.json so it cannot drift from what ships.
import { version } from '../package.json'
import { mountVue, registerZenPlugin, type ZenPanelDef } from '@nynxz/zenkit-client'
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

app.registerExtension({
  name: 'nynxz.zenexample',
  setup() {
    void registerZenPlugin({
      id: 'zenexample',
      plugin: 'Zen Example',
      version,
      description: 'A reference ZenKit plugin; its Job Lab starts test jobs of every kind.',
      panels: [JOB_LAB],
    })
  },
} as never)
