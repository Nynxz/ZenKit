<script setup lang="ts">
// Devtools-style execution waterfall: each node a row with a duration bar, live as the
// run progresses. Order view = execution order (the waterfall); Slowest = sorted desc.
// Finished runs are kept (Runs): open one or a workflow's average, and compare whatever is
// shown against a baseline — each row and the total say how much faster or slower it ran.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { goToNode } from '@nynxz/zenkit-nodekit'
import { ZenEmpty, ZenIconButton, ZenSelect, ZenToggleGroup } from '@nynxz/zenkit-ui'
import { createTimer, type FinishedRun, type NodeTiming } from '@/suite/lib/timing'
import {
  averageOf,
  comparable,
  deltasAgainst,
  keep,
  nodeKey,
  parseRuns,
  recordOf,
  sameWork,
  type RunRecord,
} from '@/suite/lib/runs'

const RUNS_LS = 'zenkit.timer.runs.v1'
const BASELINE_LS = 'zenkit.timer.baseline.v1'

function load<T>(key: string, fallback: T, read: (raw: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : read(JSON.parse(raw))
  } catch {
    return fallback
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage is a convenience */
  }
}

const runs = ref<RunRecord[]>(load(RUNS_LS, [], parseRuns))
function setRuns(next: RunRecord[]) {
  runs.value = next
  store(RUNS_LS, next)
}
function onFinished(run: FinishedRun) {
  const { rows, ...meta } = run
  setRuns(keep(runs.value, recordOf(rows, { ...meta, at: Date.now() })))
}

const timer = createTimer(onFinished)
const state = timer.state
const sort = ref<'order' | 'slowest'>('order')
const tick = ref(0)
let iv: number | undefined

/** What the body shows: the live run, the kept runs, or one of them (or an average) opened. */
const view = ref<'live' | 'runs' | 'opened'>('live')
const openedId = ref<string | null>(null)
const baseline = ref<string>(load(BASELINE_LS, 'prev', (v) => (typeof v === 'string' ? v : 'prev')))
function setBaseline(v: string) {
  baseline.value = v
  store(BASELINE_LS, v)
}

function now() {
  return performance.now()
}
// live elapsed for the running node / total (tick forces reactive re-eval while running)
function liveMs(start: number) {
  void tick.value
  return now() - start
}
function fmt(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return Math.round(ms) + ' ms'
  return (ms / 1000).toFixed(2) + ' s'
}
function when(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return time
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time
}

const AVG = 'avg:'
const opened = computed<RunRecord | null>(() => {
  const id = openedId.value
  if (!id) return null
  if (id.startsWith(AVG)) return averageOf(comparable(runs.value, id.slice(AVG.length)))
  return runs.value.find((r) => r.id === id) ?? null
})
function openRun(id: string) {
  openedId.value = id
  view.value = 'opened'
}
function backToLive() {
  openedId.value = null
  view.value = 'live'
}
function removeRun(id: string) {
  setRuns(runs.value.filter((r) => r.id !== id))
  if (openedId.value === id) backToLive()
}
function clearRuns() {
  if (!window.confirm(`Delete all ${runs.value.length} kept runs?`)) return
  setRuns([])
}

/** A kept run's nodes as rows the waterfall draws. */
const asRows = (rec: RunRecord): NodeTiming[] =>
  rec.nodes.map((n) => ({ ...n, start: 0, end: n.duration, duration: n.duration }))
const shownRows = computed<NodeTiming[]>(() =>
  view.value === 'opened' && opened.value ? asRows(opened.value) : state.rows,
)
const shownWorkflow = computed(() =>
  view.value === 'opened' && opened.value ? opened.value.workflow : state.workflow,
)
/** The run on screen, so it isn't its own baseline. */
const shownId = computed(() =>
  view.value === 'opened' && opened.value ? opened.value.id : state.runId,
)
const shownAt = computed(() =>
  view.value === 'opened' && opened.value && !opened.value.of ? opened.value.at : Infinity,
)

const sameWorkflow = computed(() =>
  comparable(runs.value, shownWorkflow.value).filter((r) => r.id !== shownId.value),
)
const baseRun = computed<RunRecord | null>(() => {
  const b = baseline.value
  if (b === 'none' || !shownWorkflow.value) return null
  if (b === 'prev') return sameWorkflow.value.find((r) => r.at < shownAt.value) ?? null
  if (b === 'avg') return averageOf(sameWorkflow.value)
  return runs.value.find((r) => r.id === b) ?? null
})
const baselineOptions = computed(() => [
  { value: 'none', label: 'Nothing' },
  { value: 'prev', label: 'Previous run' },
  { value: 'avg', label: `Average (${sameWorkflow.value.length})` },
  ...sameWorkflow.value
    .slice(0, 20)
    .map((r) => ({ value: r.id, label: `${when(r.at)} · ${fmt(r.total)}` })),
])

function durOf(r: NodeTiming): number {
  if (r.duration != null) return r.duration
  if (r.status === 'running') return liveMs(r.start)
  return 0
}

const deltas = computed(() => {
  const base = baseRun.value
  if (!base) return new Map<string, number>()
  const finished = shownRows.value
    .filter((r) => r.status !== 'running')
    .map((r) => ({ id: r.id, type: r.type, duration: durOf(r), status: r.status }))
  return deltasAgainst(finished, base)
})
const deltaOf = (r: NodeTiming) => deltas.value.get(nodeKey(r))
/** Under this, a difference is noise rather than faster or slower. */
const SAME_MS = 5
function fmtDelta(d: number): string {
  if (Math.abs(d) < SAME_MS) return '±0'
  return (d > 0 ? '+' : '−') + fmt(Math.abs(d))
}
const deltaClass = (d: number) => (Math.abs(d) < SAME_MS ? 'same' : d > 0 ? 'slower' : 'faster')

// Subgraph grouping: rows with a groupId fold under a collapsible header.
const collapsed = ref<Set<string>>(new Set())
function toggleGroup(id: string) {
  const s = new Set(collapsed.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  collapsed.value = s
}
const isCollapsed = (id: string) => collapsed.value.has(id)

interface GroupItem {
  kind: 'group'
  key: string
  id: string
  title: string
  rows: NodeTiming[]
  dur: number
  delta: number | undefined
}
interface NodeItem {
  kind: 'node'
  key: string
  row: NodeTiming
}
const tree = computed<(GroupItem | NodeItem)[]>(() => {
  const out: (GroupItem | NodeItem)[] = []
  const groups = new Map<string, GroupItem>()
  for (const r of shownRows.value) {
    if (r.groupId) {
      let g = groups.get(r.groupId)
      if (!g) {
        g = {
          kind: 'group',
          key: 'g:' + r.groupId,
          id: r.groupId,
          title: r.group || '#' + r.groupId,
          rows: [],
          dur: 0,
          delta: undefined,
        }
        groups.set(r.groupId, g)
        out.push(g)
      }
      g.rows.push(r)
    } else {
      out.push({ kind: 'node', key: 'n:' + r.id, row: r })
    }
  }
  for (const g of groups.values()) {
    g.dur = g.rows.reduce((s, r) => s + durOf(r), 0)
    const ds = g.rows.map(deltaOf).filter((d): d is number => d != null)
    g.delta = ds.length ? ds.reduce((s, d) => s + d, 0) : undefined
  }
  if (sort.value === 'slowest') {
    const w = (it: GroupItem | NodeItem) => (it.kind === 'group' ? it.dur : durOf(it.row))
    out.sort((a, b) => w(b) - w(a))
    for (const g of groups.values()) g.rows.sort((a, b) => durOf(b) - durOf(a))
  }
  return out
})
const maxBar = computed(() => {
  let m = 1
  for (const r of shownRows.value) m = Math.max(m, durOf(r))
  for (const it of tree.value) if (it.kind === 'group') m = Math.max(m, it.dur)
  return m
})
function barFromDur(d: number): number {
  return Math.max(2, Math.min(100, (d / maxBar.value) * 100))
}
function barPct(r: NodeTiming): number {
  return barFromDur(durOf(r))
}
const slowestId = computed(() => {
  let id = '',
    m = -1
  for (const r of shownRows.value) {
    const d = r.duration ?? 0
    if (d > m) {
      m = d
      id = r.id
    }
  }
  return id
})

const totalMs = computed(() => {
  if (view.value === 'opened' && opened.value) return opened.value.total
  if (state.startedAt == null) return null
  if (state.status === 'running') return liveMs(state.startedAt)
  return state.lastTotal
})
const finished = computed(() => view.value === 'opened' || state.status === 'done')
/** The baseline's total, when it did the same work as the run shown: for an average, the mean
 *  of its runs that executed the same nodes. Null when no such total exists. */
const baseTotal = computed<number | null>(() => {
  const base = baseRun.value
  if (!base || !finished.value) return null
  const shown = { nodes: shownRows.value }
  if (!base.of) return sameWork(base, shown) ? base.total : null
  const same = sameWorkflow.value.filter((r) => sameWork(r, shown))
  return same.length ? same.reduce((t, r) => t + r.total, 0) / same.length : null
})
const totalDelta = computed(() =>
  baseTotal.value != null && totalMs.value != null ? totalMs.value - baseTotal.value : null,
)
const totalPct = computed(() =>
  totalDelta.value != null && baseTotal.value
    ? Math.round((totalDelta.value / baseTotal.value) * 100)
    : null,
)
/** A baseline is set but its total covers other work (different nodes cached). */
const totalNotComparable = computed(
  () => !!baseRun.value && finished.value && baseTotal.value == null,
)

/** The kept runs' averages, one per workflow with at least two finished runs. */
const averages = computed(() => {
  const names = [...new Set(runs.value.map((r) => r.workflow))]
  return names.flatMap((w) => {
    const done = comparable(runs.value, w)
    return done.length >= 2 ? [{ workflow: w, count: done.length, avg: averageOf(done)! }] : []
  })
})

function clearShown() {
  if (view.value === 'runs') clearRuns()
  else if (view.value === 'opened') backToLive()
  else timer.clear()
}

onMounted(() => {
  iv = window.setInterval(() => {
    if (state.status === 'running') tick.value++
  }, 120)
})
onBeforeUnmount(() => {
  if (iv) clearInterval(iv)
  timer.dispose()
})
</script>

<template>
  <div class="zt">
    <div class="zt-top">
      <button
        v-if="view === 'opened'"
        class="zt-back"
        title="Back to the live run"
        @click="backToLive"
      >
        <i class="mdi mdi-arrow-left" />
        {{ opened?.of ? `Average of ${opened.of}` : opened ? when(opened.at) : 'Run' }}
      </button>
      <span v-if="view !== 'runs'" class="zt-total">{{ fmt(totalMs) }}</span>
      <span
        v-if="view !== 'runs' && totalDelta != null"
        class="zt-delta zt-tdelta"
        :class="deltaClass(totalDelta)"
        :title="`against ${fmt(baseTotal)}`"
      >
        {{ fmtDelta(totalDelta) }}
        <template v-if="totalPct">&nbsp;({{ totalPct > 0 ? '+' : '' }}{{ totalPct }}%)</template>
      </span>
      <i
        v-if="view !== 'runs' && totalNotComparable"
        class="mdi mdi-scale-unbalanced zt-dim zt-nocmp"
        title="Totals not compared: different nodes were cached, so they cover different work. The nodes still compare."
      />
      <span class="zt-grow" />
      <ZenToggleGroup
        :model-value="view === 'runs' ? 'runs' : 'live'"
        :options="[
          { value: 'live', label: 'Live' },
          { value: 'runs', label: `Runs ${runs.length}` },
        ]"
        @update:model-value="(v) => (v === 'runs' ? (view = 'runs') : backToLive())"
      />
      <ZenIconButton
        :icon="view === 'opened' ? 'mdi mdi-close' : 'mdi mdi-delete-sweep-outline'"
        :title="view === 'runs' ? 'Delete all kept runs' : view === 'opened' ? 'Close' : 'Clear'"
        :disabled="view === 'runs' && !runs.length"
        @click="clearShown"
      />
    </div>

    <div v-if="view === 'runs'" class="zt-body">
      <ZenEmpty v-if="!runs.length">
        Finished runs are kept here, to look back on, average and compare.
      </ZenEmpty>
      <button
        v-for="a in averages"
        :key="'avg:' + a.workflow"
        class="zt-run zt-avg"
        @click="openRun('avg:' + a.workflow)"
      >
        <i class="mdi mdi-sigma zt-run-ico" />
        <span class="zt-run-when">Average · {{ a.count }} runs</span>
        <span class="zt-run-wf">{{ a.workflow }}</span>
        <span class="zt-run-total">{{ fmt(a.avg.total) }}</span>
      </button>
      <div
        v-for="r in runs"
        :key="r.id"
        class="zt-run"
        role="button"
        tabindex="0"
        @click="openRun(r.id)"
        @keydown.enter="openRun(r.id)"
      >
        <i
          class="mdi zt-run-ico"
          :class="
            r.status === 'done' ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline zt-err'
          "
        />
        <span class="zt-run-when">{{ when(r.at) }}</span>
        <span class="zt-run-wf">{{ r.workflow }}</span>
        <span class="zt-run-total">{{ fmt(r.total) }}</span>
        <ZenIconButton
          class="zt-run-x"
          icon="mdi mdi-close"
          size="sm"
          title="Delete this run"
          @click.stop="removeRun(r.id)"
        />
      </div>
    </div>

    <div v-else class="zt-body">
      <ZenEmpty v-if="!shownRows.length">
        Queue a workflow — each node will appear here with its run time as it executes.
      </ZenEmpty>
      <template v-for="item in tree" :key="item.key">
        <!-- subgraph group: collapsible -->
        <div v-if="item.kind === 'group'" class="zt-group">
          <button class="zt-ghead" @click="toggleGroup(item.id)">
            <i
              class="mdi zt-gchev"
              :class="isCollapsed(item.id) ? 'mdi-chevron-right' : 'mdi-chevron-down'"
            />
            <i class="mdi mdi-shape-outline zt-gicon" />
            <span class="zt-rtitle" :title="'subgraph ' + item.id">{{ item.title }}</span>
            <span class="zt-gcount">{{ item.rows.length }}</span>
            <span v-if="item.delta != null" class="zt-delta" :class="deltaClass(item.delta)">
              {{ fmtDelta(item.delta) }}
            </span>
            <span class="zt-rdur">{{ fmt(item.dur) }}</span>
          </button>
          <div class="zt-track zt-gtrack">
            <div class="zt-bar zt-gbar" :style="{ width: barFromDur(item.dur) + '%' }" />
          </div>
          <div v-if="!isCollapsed(item.id)" class="zt-children">
            <div
              v-for="r in item.rows"
              :key="r.id"
              class="zt-row zt-child"
              :class="[r.status, { slowest: r.id === slowestId && r.status !== 'running' }]"
              role="button"
              tabindex="0"
              title="Go to this node"
              @click="goToNode(r.id)"
              @keydown.enter="goToNode(r.id)"
            >
              <div class="zt-rmeta">
                <span class="zt-rtitle" :title="r.type || r.title">{{ r.title }}</span>
                <span v-if="deltaOf(r) != null" class="zt-delta" :class="deltaClass(deltaOf(r)!)">
                  {{ fmtDelta(deltaOf(r)!) }}
                </span>
                <span class="zt-rdur">{{ r.status === 'cached' ? 'cached' : fmt(durOf(r)) }}</span>
              </div>
              <div class="zt-track">
                <div
                  class="zt-bar"
                  :class="{ live: r.status === 'running' }"
                  :style="{ width: barPct(r) + '%' }"
                />
              </div>
            </div>
          </div>
        </div>
        <!-- root-level node -->
        <div
          v-else
          class="zt-row"
          :class="[
            item.row.status,
            { slowest: item.row.id === slowestId && item.row.status !== 'running' },
          ]"
          role="button"
          tabindex="0"
          title="Go to this node"
          @click="goToNode(item.row.id)"
          @keydown.enter="goToNode(item.row.id)"
        >
          <div class="zt-rmeta">
            <span class="zt-rtitle" :title="item.row.type || item.row.title">
              {{ item.row.title }}
            </span>
            <span
              v-if="deltaOf(item.row) != null"
              class="zt-delta"
              :class="deltaClass(deltaOf(item.row)!)"
            >
              {{ fmtDelta(deltaOf(item.row)!) }}
            </span>
            <span class="zt-rdur">
              {{ item.row.status === 'cached' ? 'cached' : fmt(durOf(item.row)) }}
            </span>
          </div>
          <div class="zt-track">
            <div
              class="zt-bar"
              :class="{ live: item.row.status === 'running' }"
              :style="{ width: barPct(item.row) + '%' }"
            />
          </div>
        </div>
      </template>
    </div>

    <div class="zt-foot">
      <template v-if="view === 'runs'">
        <span>{{ runs.length }} run{{ runs.length === 1 ? '' : 's' }} kept</span>
        <span class="zt-grow" />
        <span class="zt-dim">the last 100 are kept</span>
      </template>
      <template v-else>
        <span v-if="view === 'live'" class="zt-status" :class="state.status" :title="state.status">
          <i
            class="mdi"
            :class="
              state.status === 'running'
                ? 'mdi-loading'
                : state.status === 'error'
                  ? 'mdi-alert-circle-outline'
                  : state.status === 'done'
                    ? 'mdi-check-circle-outline'
                    : 'mdi-timer-outline'
            "
          />
        </span>
        <span class="zt-dim">vs</span>
        <ZenSelect
          size="sm"
          :model-value="baseline"
          :options="baselineOptions"
          @update:model-value="setBaseline"
        />
        <span v-if="baseline !== 'none' && !baseRun" class="zt-dim zt-wf zt-nobase">
          no earlier run yet
        </span>
        <span v-else class="zt-dim zt-wf" :title="shownWorkflow">{{ shownWorkflow }}</span>
        <ZenIconButton
          size="sm"
          :icon="
            sort === 'slowest' ? 'mdi mdi-sort-descending' : 'mdi mdi-sort-clock-ascending-outline'
          "
          :active="sort === 'slowest'"
          :title="
            sort === 'slowest'
              ? 'Slowest first · click for run order'
              : 'Run order · click for slowest first'
          "
          @click="sort = sort === 'slowest' ? 'order' : 'slowest'"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.zt {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--zen-text, #e5e5e8);
  font-size: 13px;
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zt-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.zt-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--zen-surface-2, #26262d);
  color: var(--zen-muted, #b8b8bf);
}
.zt-status .mdi {
  display: block;
  width: 13px;
  height: 13px;
  font-size: 13px;
  line-height: 13px;
}
.zt-status.running {
  color: var(--zen-accent, #8b8bf5);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 16%, transparent);
}
.zt-status.running .mdi {
  animation: zt-spin 0.8s linear infinite;
  transform-origin: 50% 50%;
}
.zt-status.done {
  color: var(--zen-ok);
  background: color-mix(in srgb, var(--zen-ok) 14%, transparent);
}
.zt-status.error {
  color: var(--zen-danger);
  background: color-mix(in srgb, var(--zen-danger) 14%, transparent);
}
@keyframes zt-spin {
  to {
    transform: rotate(360deg);
  }
}
.zt-total {
  font-family: ui-monospace, monospace;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.zt-grow {
  flex: 1;
}

.zt-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  scrollbar-gutter: stable;
}
.zt-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 5px 5px;
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-text, #fff) 4%, transparent);
}
.zt-ghead {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: none;
  border: none;
  color: var(--zen-text, #e5e5e8);
  font: inherit;
  padding: 3px 2px;
  cursor: pointer;
  text-align: left;
}
.zt-gchev {
  font-size: 15px;
  color: var(--zen-muted, #9a9aa2);
  flex: 0 0 auto;
}
.zt-gicon {
  font-size: 13px;
  color: var(--zen-accent, #8b8bf5);
  flex: 0 0 auto;
}
.zt-ghead .zt-rtitle {
  font-weight: 600;
  font-size: 12px;
}
.zt-gcount {
  flex: 0 0 auto;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
  color: var(--zen-muted, #9a9aa2);
}
.zt-gtrack {
  margin: 0 2px;
}
.zt-gbar {
  background: var(--zen-accent, #8b8bf5);
  opacity: 0.9;
}
.zt-children {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 2px 14px;
  padding-left: 8px;
  border-left: 1px solid var(--zen-border, #34343c);
}
.zt-child {
  padding: 3px 6px;
}
.zt-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 7px;
  border-radius: var(--zen-radius, 8px);
}
.zt-row {
  cursor: pointer;
}
.zt-row:focus-visible {
  outline: 2px solid var(--zen-accent, #6366f1);
  outline-offset: -2px;
}
.zt-row:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 5%, transparent);
}
.zt-row.running {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 9%, transparent);
}
.zt-rmeta {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.zt-rtitle {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.zt-rdur {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--zen-muted, #9a9aa2);
}
.zt-row.running .zt-rdur {
  color: var(--zen-accent, #8b8bf5);
}
.zt-track {
  height: 6px;
  border-radius: calc(var(--zen-radius, 8px) / 2);
  background: color-mix(in srgb, var(--zen-text, #fff) 8%, transparent);
  overflow: hidden;
}
.zt-bar {
  height: 100%;
  border-radius: calc(var(--zen-radius, 8px) / 2);
  background: var(--zen-accent, #6366f1);
  transition: width 0.12s linear;
}
.zt-bar.live {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent),
    var(--zen-accent, #8b8bf5)
  );
  animation: zt-pulse 1s ease-in-out infinite;
}
@keyframes zt-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
.zt-row.cached .zt-bar {
  background: repeating-linear-gradient(
    45deg,
    var(--zen-muted, #76767e),
    var(--zen-muted, #76767e) 3px,
    transparent 3px,
    transparent 6px
  );
  opacity: 0.5;
}
.zt-row.cached .zt-rdur {
  font-style: italic;
}
.zt-row.error .zt-bar {
  background: var(--zen-danger);
}
.zt-row.slowest .zt-bar {
  background: #f59e0b;
}
.zt-row.slowest .zt-rdur {
  color: #f59e0b;
}

.zt-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-top: 1px solid var(--zen-border, #34343c);
  font-size: 11px;
  color: var(--zen-muted, #9a9aa2);
}
.zt-dim {
  color: var(--zen-muted, #76767e);
}

.zt-nobase {
  font-style: italic;
}
.zt-nocmp {
  font-size: 14px;
  cursor: help;
}
.zt-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 2px 4px;
  border: none;
  border-radius: var(--zen-radius, 8px);
  background: var(--zen-surface-2, #26262d);
  color: var(--zen-text, #e5e5e8);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.zt-back:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
}
.zt-delta {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  padding: 0 5px;
  border-radius: var(--zen-radius, 8px);
}
.zt-delta.slower {
  color: var(--zen-danger, #ef4444);
  background: color-mix(in srgb, var(--zen-danger, #ef4444) 12%, transparent);
}
.zt-delta.faster {
  color: var(--zen-ok, #22c55e);
  background: color-mix(in srgb, var(--zen-ok, #22c55e) 12%, transparent);
}
.zt-delta.same {
  color: var(--zen-muted, #9a9aa2);
}
.zt-tdelta {
  font-size: 11px;
  padding: 1px 6px;
}
.zt-run {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 3px 4px 3px 8px;
  border: none;
  border-radius: var(--zen-radius, 8px);
  background: none;
  color: var(--zen-text, #e5e5e8);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.zt-run:hover,
.zt-run:focus-visible {
  background: color-mix(in srgb, var(--zen-text, #fff) 6%, transparent);
}
.zt-avg {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 9%, transparent);
}
.zt-run-ico {
  flex: 0 0 auto;
  font-size: 14px;
  color: var(--zen-ok, #22c55e);
}
.zt-avg .zt-run-ico {
  color: var(--zen-accent, #8b8bf5);
}
.zt-run-ico.zt-err {
  color: var(--zen-danger, #ef4444);
}
.zt-run-when {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.zt-run-wf,
.zt-wf {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--zen-muted, #9a9aa2);
}
.zt-run-total {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
}
.zt-avg .zt-run-total {
  margin-right: 28px;
}
</style>
