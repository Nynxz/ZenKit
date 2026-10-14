import { app } from '@comfy/app'
// The pack version, read from package.json so it cannot drift from what ships.
import { version } from '../package.json'
// The family tile from docs/assets/render/brand.mjs; the build inlines it as a data URI.
import logo from './logo.svg'
import {
  mountVue,
  mountVueApp,
  registerZenPlugin,
  type ZenAppDef,
  type ZenPanelDef,
} from '@nynxz/zenkit-client'
import AgentChat from '@/components/AgentChat.vue'
import AgentPanel from '@/components/AgentPanel.vue'

// Zen Agent — chat with a local model that can read, edit and run the workflow on the canvas.
// The conversation runs in this pack's backend (zenagent/), the graph tools in this browser
// (lib/graphTools.ts).
const AGENT: ZenPanelDef = {
  id: 'agent', // short id → auto-prefixed to 'zenagent:agent'
  title: 'Agent',
  icon: 'mdi mdi-creation-outline',
  width: 440,
  height: 720,
  minWidth: 340,
  minHeight: 420,
  render: mountVue(AgentPanel),
}

// The same agent as a full-screen chat: saved chats, a model per chat, a reading column.
const CHAT: ZenAppDef = {
  id: 'chat',
  title: 'Chat',
  icon: 'mdi mdi-chat-processing-outline',
  routes: [
    { path: '', title: 'New chat' },
    { path: 'c/:id', title: 'Chat' },
  ],
  mount: mountVueApp(AgentChat),
}

app.registerExtension({
  name: 'nynxz.zenagent',
  setup() {
    void registerZenPlugin({
      id: 'zenagent',
      plugin: 'Zen Agent',
      version,
      logo,
      description: 'Chat with a local model that can read, edit and run your workflow.',
      panels: [AGENT],
      apps: [CHAT],
    })
  },
} as never)
