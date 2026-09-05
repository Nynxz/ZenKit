<script setup lang="ts">
// Right column of the master–detail. Tabs keep the deep lists (nodes, served JS, ZenKit
// surfaces) out of each other's way instead of stacking them into one endless column, and
// each tab body scrolls inside the pane rather than growing it.
import { computed, ref, watch } from 'vue'
import { JsonTree } from '@nynxz/zenkit-ui'
import IssueList from './IssueList.vue'
import NodeTable from './NodeTable.vue'
import type { Pack, Snapshot } from '@/lib/types'

const props = defineProps<{ pack: Pack; sources: Snapshot['sources'] }>()

type Tab = 'overview' | 'nodes' | 'frontend' | 'zenkit' | 'raw'
const tab = ref<Tab>('overview')
const nodeQuery = ref('')

// Selecting another pack must not strand you on a tab it doesn't have.
watch(
  () => props.pack.key,
  () => {
    tab.value = 'overview'
    nodeQuery.value = ''
  },
)

const tabs = computed(() => {
  const p = props.pack
  const out: { id: Tab; label: string; n?: number }[] = [{ id: 'overview', label: 'Overview' }]
  out.push({ id: 'nodes', label: 'Nodes', n: p.nodes.length })
  out.push({ id: 'frontend', label: 'Frontend', n: p.web.length + p.extensions.length })
  if (p.zen) out.push({ id: 'zenkit', label: 'ZenKit' })
  out.push({ id: 'raw', label: 'Raw' })
  return out
})

const filteredNodes = computed(() => {
  const q = nodeQuery.value.trim().toLowerCase()
  if (!q) return props.pack.nodes
  return props.pack.nodes.filter(
    (n) =>
      n.cls.toLowerCase().includes(q) ||
      n.display.toLowerCase().includes(q) ||
      n.category.toLowerCase().includes(q),
  )
})

const stats = computed(() => {
  const p = props.pack
  return [
    { icon: 'mdi-graph-outline', n: p.nodes.length, label: 'nodes' },
    { icon: 'mdi-language-javascript', n: p.web.length, label: 'js files' },
    { icon: 'mdi-puzzle-outline', n: p.extensions.length, label: 'extensions' },
    { icon: 'mdi-alert-circle-outline', n: p.issues.length, label: 'issues' },
  ]
})

const STYLE_HINT: Record<'v1' | 'v3' | 'none', string> = {
  v1: 'Registers through a NODE_CLASS_MAPPINGS dict',
  v3: 'Registers through the V3 API — comfy_entrypoint() returning a ComfyExtension, so there is no mapping dict to compare against',
  none: 'Registers no nodes',
}

const STATE_TONE: Record<Pack['state'], string> = {
  loaded: 'ok',
  failed: 'err',
  disabled: 'warn',
  unknown: '',
}
const STATE_LABEL: Record<Pack['state'], string> = {
  loaded: 'loaded',
  failed: 'import failed',
  disabled: 'disabled',
  unknown: 'state unknown',
}

// Nodes whose registration the two halves disagree about — the headline of the Nodes tab.
const notOnCanvas = computed(
  () => props.pack.nodes.filter((n) => n.clientRegistered === false).length,
)

const raw = computed(() => ({
  key: props.pack.key,
  source: props.pack.source,
  state: props.pack.state,
  pythonModules: props.pack.pythonModules,
  backend: props.pack.py,
  web: props.pack.web.map((w) => w.url),
  extensions: props.pack.extensions,
  zenkit: props.pack.zen,
  issues: props.pack.issues,
}))
</script>

<template>
  <div class="pd">
    <!-- identity -->
    <header class="pd-head">
      <div class="pd-title">
        <img v-if="pack.zen?.logo" :src="pack.zen.logo" class="pd-logo" alt="" />
        <span class="pd-name zi-ell">{{ pack.label }}</span>
        <span v-if="pack.version" class="zi-chip">v{{ pack.version }}</span>
        <span v-if="pack.state !== 'unknown'" class="zi-chip" :class="STATE_TONE[pack.state]">
          {{ STATE_LABEL[pack.state] }}
        </span>
      </div>
      <div class="pd-meta">
        <code v-if="pack.pythonModules.length" :title="pack.pythonModules.join('\n')">
          {{ pack.pythonModules[0] }}
        </code>
        <code v-else-if="!pack.key.startsWith('@')">{{ pack.key }}</code>
        <span
          v-if="pack.git?.branch"
          class="zi-chip"
          :title="pack.git.repo ? `repo: ${pack.git.repo}` : undefined"
        >
          <i class="mdi mdi-source-branch" />
          {{ pack.git.branch }}
          <template v-if="pack.git.commit">@{{ pack.git.commit }}</template>
          <template v-if="pack.git.repo">({{ pack.git.repo }})</template>
        </span>
        <span v-if="pack.path" class="pd-path zi-ell" :title="pack.path">{{ pack.path }}</span>
      </div>
    </header>

    <!-- tabs -->
    <nav class="pd-tabs">
      <button v-for="t in tabs" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">
        {{ t.label }}
        <span v-if="t.n" class="zi-num pd-tn">{{ t.n }}</span>
      </button>
    </nav>

    <!-- ── overview ─────────────────────────────────────────────────────────────── -->
    <div v-if="tab === 'overview'" class="zi-scroll pd-body">
      <p v-if="pack.description" class="pd-desc">{{ pack.description }}</p>

      <div class="pd-stats">
        <div v-for="s in stats" :key="s.label" class="pd-stat">
          <i class="mdi" :class="s.icon" />
          <b class="zi-num">{{ s.n }}</b>
          <span class="zi-mut">{{ s.label }}</span>
        </div>
      </div>

      <section v-if="pack.issues.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-stethoscope" />
          Diagnostics
        </div>
        <IssueList :issues="pack.issues" />
      </section>
      <div v-else class="pd-clean">
        <i class="mdi mdi-check-circle-outline zi-fg-ok" />
        <span>
          No problems detected{{
            sources.backend === 'ok'
              ? ''
              : " (backend route unavailable — import failures can't be seen)"
          }}.
        </span>
      </div>

      <!-- Only meaningful with the backend route; it's where declared/effective comes from. -->
      <section v-if="pack.py && pack.py.style !== 'none'" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-clipboard-check-outline" />
          Registration
        </div>
        <div class="zi-row zi-wrap">
          <span class="zi-chip" :title="STYLE_HINT[pack.py.style]">
            <i class="mdi mdi-api" />
            {{ pack.py.style === 'v3' ? 'V3 comfy_entrypoint' : 'NODE_CLASS_MAPPINGS' }}
          </span>
          <span v-if="pack.py.style === 'v1'" class="zi-chip">
            <b class="zi-num">{{ pack.py.declared.length }}</b>
            declared
          </span>
          <span class="zi-chip ok">
            <b class="zi-num">{{ pack.py.nodes.length }}</b>
            registered
          </span>
          <span v-if="pack.py.shadowed.length" class="zi-chip err">
            <b class="zi-num">{{ pack.py.shadowed.length }}</b>
            lost to another pack
          </span>
          <span v-if="pack.py.undeclared.length" class="zi-chip info">
            <b class="zi-num">{{ pack.py.undeclared.length }}</b>
            undeclared
          </span>
        </div>
      </section>
    </div>

    <!-- ── nodes ────────────────────────────────────────────────────────────────── -->
    <template v-else-if="tab === 'nodes'">
      <div class="pd-bar">
        <div class="zi-search">
          <i class="mdi mdi-magnify" />
          <input v-model="nodeQuery" placeholder="filter this pack's nodes…" spellcheck="false" />
        </div>
        <span v-if="notOnCanvas" class="zi-chip warn">{{ notOnCanvas }} not on canvas</span>
        <span class="zi-chip zi-num">{{ filteredNodes.length }}/{{ pack.nodes.length }}</span>
      </div>
      <div class="zi-scroll pd-body">
        <NodeTable :nodes="filteredNodes" />
      </div>
    </template>

    <!-- ── frontend ─────────────────────────────────────────────────────────────── -->
    <div v-else-if="tab === 'frontend'" class="zi-scroll pd-body">
      <section class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-language-javascript" />
          Served files
          <span class="zi-chip zi-num">{{ pack.web.length }}</span>
        </div>
        <div v-if="!pack.web.length" class="zi-mut">
          This pack serves no frontend files (no WEB_DIRECTORY).
        </div>
        <div v-for="w in pack.web" :key="w.url" class="zi-row">
          <code class="zi-ell" :title="w.url">{{ w.url }}</code>
        </div>
      </section>

      <section class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-puzzle-outline" />
          Registered extensions
          <span class="zi-chip zi-num">{{ pack.extensions.length }}</span>
        </div>
        <div v-if="!pack.extensions.length" class="zi-mut">
          Nothing in
          <code>app.extensions</code>
          matched this pack.
        </div>
        <div v-for="e in pack.extensions" :key="e" class="zi-row">
          <i class="mdi mdi-check zi-fg-ok" />
          <code>{{ e }}</code>
        </div>
        <p class="pd-note">
          ComfyUI doesn't record which pack an extension came from, so these are matched by name. A
          pack can register under an unrelated name and still be fine.
        </p>
      </section>
    </div>

    <!-- ── zenkit surfaces ──────────────────────────────────────────────────────── -->
    <div v-else-if="tab === 'zenkit' && pack.zen" class="zi-scroll pd-body">
      <div class="zi-row">
        <code>{{ pack.zen.id }}</code>
        <span v-if="pack.zen.namespace" class="zi-chip">ns: {{ pack.zen.namespace }}</span>
      </div>

      <section v-if="pack.zen.panels.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-dock-window" />
          Panels
          <span class="zi-chip zi-num">{{ pack.zen.panels.length }}</span>
        </div>
        <div v-for="x in pack.zen.panels" :key="x.id" class="zi-row">
          <code>{{ x.id }}</code>
          <span class="zi-mut zi-ell">{{ x.title }}</span>
          <span v-if="x.multi" class="zi-chip">multi</span>
          <span v-if="x.spawnOnly" class="zi-chip">spawn-only</span>
        </div>
      </section>

      <section v-if="pack.zen.apps.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-application" />
          Apps
          <span class="zi-chip zi-num">{{ pack.zen.apps.length }}</span>
        </div>
        <!-- namespace is optional on an app and defaults to the plugin id — don't render
             the string "undefined" into a route that reads as authoritative -->
        <div v-for="x in pack.zen.apps" :key="x.id" class="zi-row">
          <code>{{ x.namespace ?? pack.zen.namespace ?? pack.zen.id }}/{{ x.id }}</code>
          <span class="zi-mut zi-ell">{{ x.title }}</span>
          <span class="zi-chip">
            {{ x.routes.length ? x.routes.map((r) => r || '(index)').join(', ') : 'no routes' }}
          </span>
        </div>
      </section>

      <section v-if="pack.zen.taskbarWidgets.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-dock-bottom" />
          Taskbar widgets
        </div>
        <div v-for="x in pack.zen.taskbarWidgets" :key="x.id" class="zi-row">
          <code>{{ x.id }}</code>
          <span class="zi-mut">{{ x.label }}</span>
        </div>
      </section>

      <section v-if="pack.zen.themes.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-palette-outline" />
          Themes
          <span class="zi-chip zi-num">{{ pack.zen.themes.length }}</span>
        </div>
        <div class="zi-row zi-wrap">
          <code v-for="x in pack.zen.themes" :key="x.id">{{ x.id }}</code>
        </div>
      </section>

      <section v-if="pack.zen.backgrounds.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-image-filter-hdr" />
          Backgrounds
        </div>
        <div class="zi-row zi-wrap">
          <code v-for="x in pack.zen.backgrounds" :key="x.id">{{ x.id }}</code>
        </div>
      </section>

      <section v-if="pack.zen.channels.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-broadcast" />
          Channels
        </div>
        <div class="zi-row zi-wrap">
          <code v-for="c in pack.zen.channels" :key="c">{{ c }}</code>
        </div>
      </section>

      <section v-if="pack.zen.slotLinks.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-vector-link" />
          Slot links
        </div>
        <div v-for="(x, i) in pack.zen.slotLinks" :key="i" class="zi-row">
          <code>{{ x.node }}.{{ x.slot }}</code>
          <i class="mdi mdi-arrow-right zi-mut" />
          <code>{{ x.spawn }}</code>
        </div>
      </section>

      <section v-if="pack.zen.widgetViews.length" class="zi-sect">
        <div class="zi-sect-h">
          <i class="mdi mdi-widgets-outline" />
          Widget views
        </div>
        <div class="zi-row zi-wrap">
          <code v-for="w in pack.zen.widgetViews" :key="w">{{ w }}</code>
        </div>
      </section>
    </div>

    <!-- ── raw ──────────────────────────────────────────────────────────────────── -->
    <div v-else class="zi-scroll pd-body">
      <JsonTree :data="raw" :default-open="1" />
    </div>
  </div>
</template>

<style scoped>
.pd {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.pd-head {
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--zi-line);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pd-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex-wrap: wrap;
}
.pd-logo {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  object-fit: cover;
}
.pd-name {
  font-weight: 700;
  font-size: 13px;
}
.pd-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
  font-size: 11px;
}
.pd-path {
  color: var(--zen-muted, #9aa0aa);
  font-size: 10px;
  max-width: 100%;
}

.pd-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--zi-line);
  flex: 0 0 auto;
  overflow-x: auto;
}
.pd-tabs button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  padding: 4px 9px 5px;
  cursor: pointer;
  white-space: nowrap;
}
.pd-tabs button:hover {
  color: var(--zen-text, #fff);
}
.pd-tabs button.on {
  color: var(--zen-text, #fff);
  border-bottom-color: var(--zen-accent, #3b82f6);
}
.pd-tn {
  margin-left: 5px;
  font-size: 10px;
  opacity: 0.7;
}

.pd-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--zi-line);
  flex: 0 0 auto;
}
.pd-body {
  padding: 9px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pd-desc {
  color: var(--zen-muted, #9aa0aa);
  margin: 0;
}

.pd-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 6px;
}
.pd-stat {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px;
  border: 1px solid var(--zi-line);
  border-radius: var(--zen-radius, 6px);
  background: var(--zi-fill);
}
.pd-stat i {
  color: var(--zen-accent, #3b82f6);
}
.pd-stat b {
  font-size: 14px;
}

.pd-clean {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--zen-muted, #9aa0aa);
}
.pd-note {
  color: var(--zen-muted, #9aa0aa);
  font-size: 10px;
  margin: 4px 0 0;
  line-height: 1.4;
}
.zi-wrap {
  flex-wrap: wrap;
  gap: 4px;
}
</style>
