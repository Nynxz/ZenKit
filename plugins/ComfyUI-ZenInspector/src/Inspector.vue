<script setup lang="ts">
// The Zen Inspector — a debug view of the whole ComfyUI install, not just ZenKit.
//
// Three modes over one snapshot (see lib/scan.ts for how the sources are joined):
//   Packs   master–detail: every nodepack/extension and whether it's properly registered
//   Nodes   flat, searchable table of every registered node in the install
//   Issues  only the disagreements between sources — the reason to open this panel
//
// ZenKit is not required: without it the panel still inspects the install, and a ZenKit
// plugin simply gains an extra tab. It re-scans on the 'plugins:change' bus event.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { whenZen, type ZenKitApi } from '@nynxz/zenkit-client'
import { ZenIconButton, ZenToolbar } from '@nynxz/zenkit-ui'
import IssueList from '@/components/IssueList.vue'
import NodeTable from '@/components/NodeTable.vue'
import PackDetail from '@/components/PackDetail.vue'
import PackList from '@/components/PackList.vue'
import { scan } from '@/lib/scan'
import { EMPTY_SNAPSHOT, type IssueLevel, type Pack, type Snapshot } from '@/lib/types'
import '@/ui.css'

type Mode = 'packs' | 'nodes' | 'issues'
type SourceFilter = 'all' | 'custom' | 'core'

const zen = ref<ZenKitApi | null>(null)
const snap = ref<Snapshot>(EMPTY_SNAPSHOT)
const loading = ref(true)
const error = ref('')

const mode = ref<Mode>('packs')
const query = ref('')
const sourceFilter = ref<SourceFilter>('custom')
const onlyProblems = ref(false)
const onlyUnregistered = ref(false)
const levelFilter = ref<'all' | IssueLevel>('all')
const selected = ref<string | null>(null)

let offBus: (() => void) | null = null
/** The in-flight scan, so a late-arriving ZenKit can wait for it rather than racing it. */
let inflight: Promise<void> = Promise.resolve()

function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  inflight = scan(zen.value)
    .then((s) => {
      snap.value = s
    })
    .catch((e: unknown) => {
      error.value = e instanceof Error ? e.message : String(e)
    })
    .finally(() => {
      loading.value = false
    })
  return inflight
}

onMounted(() => {
  // ZenKit is optional here — the inspector's job is the install, and the ledger is one
  // more layer on top. Don't block the first scan on a runtime that may never arrive
  // (whenZen only gives up after a timeout).
  void whenZen().then(async (z) => {
    zen.value = z
    if (!z) return
    offBus = z.bus.on('plugins:change', () => void refresh())
    // Wait for whatever scan is running before deciding: it may have started before
    // zen.value was set, in which case its result won't have the ledger in it.
    await inflight
    if (!snap.value.sources.zen) await refresh()
  })
  void refresh()
})
onBeforeUnmount(() => offBus?.())

/* ── filtering ─────────────────────────────────────────────────────────────────────── */

const q = computed(() => query.value.trim().toLowerCase())

const packLabels = computed(
  () => Object.fromEntries(snap.value.packs.map((p) => [p.key, p.label])) as Record<string, string>,
)

const inSource = (p: Pack) =>
  sourceFilter.value === 'all' ||
  (sourceFilter.value === 'custom' ? p.source === 'custom' : p.source !== 'custom')

const packs = computed(() =>
  snap.value.packs.filter((p) => {
    if (!inSource(p)) return false
    if (onlyProblems.value && !p.issues.length) return false
    if (!q.value) return true
    return (
      p.label.toLowerCase().includes(q.value) ||
      p.key.toLowerCase().includes(q.value) ||
      p.pythonModules.some((m) => m.toLowerCase().includes(q.value)) ||
      // Searching for a node you can't place and landing on its pack is the common case.
      p.nodes.some(
        (n) => n.cls.toLowerCase().includes(q.value) || n.display.toLowerCase().includes(q.value),
      )
    )
  }),
)

const current = computed<Pack | null>(() => {
  const list = packs.value
  if (!list.length) return null
  return list.find((p) => p.key === selected.value) ?? list[0]
})

const packOf = computed(() => new Map(snap.value.packs.map((p) => [p.key, p])))

const nodes = computed(() =>
  snap.value.nodes.filter((n) => {
    const pack = packOf.value.get(n.pack)
    if (pack && !inSource(pack)) return false
    if (onlyUnregistered.value && n.clientRegistered !== false) return false
    if (!q.value) return true
    return (
      n.cls.toLowerCase().includes(q.value) ||
      n.display.toLowerCase().includes(q.value) ||
      n.category.toLowerCase().includes(q.value) ||
      n.pack.toLowerCase().includes(q.value)
    )
  }),
)

const issues = computed(() =>
  snap.value.issues.filter((i) => {
    if (levelFilter.value !== 'all' && i.level !== levelFilter.value) return false
    if (!q.value) return true
    const label = i.pack ? (packLabels.value[i.pack] ?? i.pack) : ''
    return (
      i.title.toLowerCase().includes(q.value) ||
      i.detail.toLowerCase().includes(q.value) ||
      label.toLowerCase().includes(q.value)
    )
  }),
)

/** Jump from a node row or an issue to the pack that owns it, clearing whatever filter
 *  would otherwise hide it — nothing is more annoying than a link to an empty pane. */
function gotoPack(key: string) {
  mode.value = 'packs'
  selected.value = key
  onlyProblems.value = false
  query.value = ''
  const p = packOf.value.get(key)
  if (p && !inSource(p)) sourceFilter.value = 'all'
}

/* ── footer status ─────────────────────────────────────────────────────────────────── */

const sourceChips = computed(() => {
  const s = snap.value.sources
  return [
    {
      label: '/object_info',
      ok: s.objectInfo === 'ok',
      note: s.objectInfo,
      hint: 'every registered node',
    },
    {
      label: '/extensions',
      ok: s.extensions === 'ok',
      note: s.extensions,
      hint: 'JS files served per pack',
    },
    {
      label: 'backend',
      ok: s.backend === 'ok',
      note: s.backend,
      hint: 'GET /zeninspector/inspect — import failures, versions, ownership',
    },
    {
      label: 'litegraph',
      ok: s.litegraph,
      note: s.litegraph ? 'ok' : 'absent',
      hint: 'client-side node registration checks',
    },
    { label: 'zenkit', ok: s.zen, note: s.zen ? 'ok' : 'absent', hint: 'ZenKit plugin ledger' },
  ]
})

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: 'packs', label: 'Packs', icon: 'mdi-package-variant-closed' },
  { id: 'nodes', label: 'Nodes', icon: 'mdi-graph-outline' },
  { id: 'issues', label: 'Issues', icon: 'mdi-stethoscope' },
]
</script>

<template>
  <div class="zi">
    <ZenToolbar title="Zen Inspector" icon="mdi mdi-magnify-scan">
      <template #start>
        <div class="zi-seg zi-modes">
          <button
            v-for="m in MODES"
            :key="m.id"
            :class="{ on: mode === m.id }"
            @click="mode = m.id"
          >
            <i class="mdi" :class="m.icon" />
            <span class="zi-mlabel">{{ m.label }}</span>
            <span
              v-if="m.id === 'issues' && snap.stats.errors + snap.stats.warnings"
              class="zi-mbadge"
              :class="snap.stats.errors ? 'err' : 'warn'"
            >
              {{ snap.stats.errors + snap.stats.warnings }}
            </span>
          </button>
        </div>
      </template>
      <ZenIconButton
        :icon="loading ? 'mdi mdi-loading mdi-spin' : 'mdi mdi-refresh'"
        title="Re-scan"
        :disabled="loading"
        @click="refresh()"
      />
    </ZenToolbar>

    <!-- filter bar — its own row, so it never squeezes the toolbar or the content -->
    <div class="zi-bar">
      <div class="zi-search">
        <i class="mdi mdi-magnify" />
        <input
          v-model="query"
          :placeholder="
            mode === 'nodes'
              ? 'filter nodes…'
              : mode === 'issues'
                ? 'filter issues…'
                : 'filter packs and nodes…'
          "
          spellcheck="false"
        />
        <i v-if="query" class="mdi mdi-close zi-clear" @click="query = ''" />
      </div>

      <div v-if="mode !== 'issues'" class="zi-seg">
        <button :class="{ on: sourceFilter === 'custom' }" @click="sourceFilter = 'custom'">
          custom
        </button>
        <button :class="{ on: sourceFilter === 'core' }" @click="sourceFilter = 'core'">
          core
        </button>
        <button :class="{ on: sourceFilter === 'all' }" @click="sourceFilter = 'all'">all</button>
      </div>
      <div v-else class="zi-seg">
        <button :class="{ on: levelFilter === 'all' }" @click="levelFilter = 'all'">all</button>
        <button :class="{ on: levelFilter === 'error' }" @click="levelFilter = 'error'">
          errors
        </button>
        <button :class="{ on: levelFilter === 'warn' }" @click="levelFilter = 'warn'">
          warnings
        </button>
        <button :class="{ on: levelFilter === 'info' }" @click="levelFilter = 'info'">info</button>
      </div>

      <button
        v-if="mode === 'packs'"
        class="zi-chip zi-toggle"
        :class="{ on: onlyProblems }"
        title="Only packs with something to report"
        @click="onlyProblems = !onlyProblems"
      >
        <i class="mdi mdi-alert-circle-outline" />
        problems
      </button>
      <button
        v-if="mode === 'nodes'"
        class="zi-chip zi-toggle"
        :class="{ on: onlyUnregistered }"
        title="Only nodes the server has but the canvas doesn't"
        @click="onlyUnregistered = !onlyUnregistered"
      >
        <i class="mdi mdi-alert-circle-outline" />
        not on canvas
      </button>

      <span class="zi-chip zi-num">
        {{ mode === 'packs' ? packs.length : mode === 'nodes' ? nodes.length : issues.length }}
      </span>
    </div>

    <div v-if="error" class="zi-err-bar">
      <i class="mdi mdi-alert" />
      Scan failed: {{ error }}
    </div>

    <!-- ── body ─────────────────────────────────────────────────────────────────── -->
    <div v-if="loading && !snap.scannedAt" class="zi-empty">
      <i class="mdi mdi-loading mdi-spin" />
      <span>Scanning install…</span>
    </div>

    <div v-else-if="mode === 'packs'" class="zi-split">
      <PackList :packs="packs" :selected="current?.key ?? null" @select="selected = $event" />
      <PackDetail v-if="current" :pack="current" :sources="snap.sources" />
      <div v-else class="zi-empty">
        <i class="mdi mdi-package-variant" />
        <span>No pack matches.</span>
      </div>
    </div>

    <div v-else-if="mode === 'nodes'" class="zi-scroll zi-pad">
      <NodeTable :nodes="nodes" show-pack :pack-labels="packLabels" @goto-pack="gotoPack" />
    </div>

    <div v-else class="zi-scroll zi-pad">
      <div v-if="!issues.length" class="zi-empty">
        <i class="mdi mdi-check-circle-outline zi-fg-ok" />
        <span>Nothing to report{{ levelFilter === 'all' ? '' : ' at this level' }}.</span>
        <span v-if="snap.sources.backend !== 'ok'" class="zi-mut">
          The backend route isn't answering, so packs that failed to import can't be detected.
        </span>
      </div>
      <template v-else>
        <IssueList :issues="issues" show-pack :pack-labels="packLabels" @goto-pack="gotoPack" />
      </template>

      <section v-if="snap.orphanExtensions.length" class="zi-sect zi-orphans">
        <div class="zi-sect-h">
          <i class="mdi mdi-help-rhombus-outline" />
          Unattributed frontend extensions
          <span class="zi-chip zi-num">{{ snap.orphanExtensions.length }}</span>
        </div>
        <div class="zi-row zi-wrap">
          <code v-for="e in snap.orphanExtensions" :key="e">{{ e }}</code>
        </div>
        <p class="zi-mut zi-note">
          Registered, but their name matches no installed pack. Usually fine.
        </p>
      </section>
    </div>

    <!-- ── footer ───────────────────────────────────────────────────────────────── -->
    <footer class="zi-foot">
      <span
        v-for="c in sourceChips"
        :key="c.label"
        class="zi-chip"
        :class="c.ok ? 'ok' : ''"
        :title="`${c.hint} — ${c.note}`"
      >
        <i class="mdi" :class="c.ok ? 'mdi-check' : 'mdi-minus'" />
        {{ c.label }}
      </span>
      <span class="zi-fgrow" />
      <span class="zi-mut zi-num">
        {{ snap.stats.custom }} packs · {{ snap.stats.customNodes }}/{{ snap.stats.nodes }} nodes
        custom
        <template v-if="snap.stats.failed">· {{ snap.stats.failed }} failed</template>
      </span>
    </footer>
  </div>
</template>

<style scoped>
.zi-modes button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.zi-mbadge {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.zi-mbadge.err {
  background: var(--zi-err);
  color: #fff;
}
.zi-mbadge.warn {
  background: var(--zi-warn);
  color: #1a1a1f;
}

.zi-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  border-bottom: 1px solid var(--zi-line);
  flex: 0 0 auto;
}
.zi-clear {
  cursor: pointer;
}
.zi-clear:hover {
  color: var(--zen-text, #fff);
}
.zi-toggle {
  border: none;
  font: inherit;
  cursor: pointer;
}
.zi-toggle:hover {
  color: var(--zen-text, #fff);
}

.zi-err-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  color: var(--zi-err);
  background: color-mix(in srgb, var(--zi-err) 12%, transparent);
  flex: 0 0 auto;
}

/* The split: two independent scroll regions, both clamped by min-height:0 so neither can
   stretch the panel. This is what the old single-column accordion couldn't do. */
.zi-split {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
}
.zi-pad {
  padding: 8px 10px 14px;
}
.zi-wrap {
  flex-wrap: wrap;
  gap: 4px;
}
.zi-orphans {
  margin-top: 14px;
}
.zi-note {
  font-size: 10px;
  margin: 4px 0 0;
}

.zi-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border-top: 1px solid var(--zi-line);
  font-size: 10px;
  flex: 0 0 auto;
  overflow-x: auto;
}
.zi-fgrow {
  flex: 1 1 auto;
  min-width: 6px;
}
</style>
