<script setup lang="ts">
// Devtools-style execution waterfall: each node a row with a duration bar, live as the
// run progresses. Order view = execution order (the waterfall); Slowest = sorted desc.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ZenIconButton, ZenToggleGroup } from '@nynxz/zenkit-ui'
import { createTimer, type NodeTiming } from '@/lib/timing'

const timer = createTimer()
const state = timer.state
const sort = ref<'order' | 'slowest'>('order')
const tick = ref(0)
let iv: number | undefined

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

function durOf(r: NodeTiming): number {
  if (r.duration != null) return r.duration
  if (r.status === 'running') return liveMs(r.start)
  return 0
}

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
}
interface NodeItem {
  kind: 'node'
  key: string
  row: NodeTiming
}
const tree = computed<(GroupItem | NodeItem)[]>(() => {
  const out: (GroupItem | NodeItem)[] = []
  const groups = new Map<string, GroupItem>()
  for (const r of state.rows) {
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
        }
        groups.set(r.groupId, g)
        out.push(g)
      }
      g.rows.push(r)
    } else {
      out.push({ kind: 'node', key: 'n:' + r.id, row: r })
    }
  }
  for (const g of groups.values()) g.dur = g.rows.reduce((s, r) => s + durOf(r), 0)
  if (sort.value === 'slowest') {
    const w = (it: GroupItem | NodeItem) => (it.kind === 'group' ? it.dur : durOf(it.row))
    out.sort((a, b) => w(b) - w(a))
    for (const g of groups.values()) g.rows.sort((a, b) => durOf(b) - durOf(a))
  }
  return out
})
const maxBar = computed(() => {
  let m = 1
  for (const r of state.rows) m = Math.max(m, durOf(r))
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
  for (const r of state.rows) {
    const d = r.duration ?? 0
    if (d > m) {
      m = d
      id = r.id
    }
  }
  return id
})

const totalMs = computed(() => {
  if (state.startedAt == null) return null
  if (state.status === 'running') return liveMs(state.startedAt)
  return state.lastTotal
})
const doneCount = computed(
  () => state.rows.filter((r) => r.status === 'done' || r.status === 'cached').length,
)

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
      <span class="zt-status" :class="state.status">
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
        {{ state.status }}
      </span>
      <span class="zt-total">{{ fmt(totalMs) }}</span>
      <span class="zt-grow" />
      <ZenToggleGroup
        :model-value="sort"
        :options="[
          { value: 'order', label: 'Order' },
          { value: 'slowest', label: 'Slowest' },
        ]"
        @update:model-value="(v) => (sort = v === 'slowest' ? 'slowest' : 'order')"
      />
      <ZenIconButton icon="mdi mdi-delete-sweep-outline" title="Clear" @click="timer.clear()" />
    </div>

    <div class="zt-body">
      <div v-if="!state.rows.length" class="zt-empty">
        <i class="mdi mdi-timer-outline" />
        <p>Queue a workflow — each node will appear here with its run time as it executes.</p>
      </div>
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
            >
              <div class="zt-rmeta">
                <span class="zt-rtitle" :title="r.type || r.title">{{ r.title }}</span>
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
        >
          <div class="zt-rmeta">
            <span class="zt-rtitle" :title="item.row.type || item.row.title">
              {{ item.row.title }}
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
      <span>{{ state.rows.length }} node{{ state.rows.length === 1 ? '' : 's' }}</span>
      <span v-if="doneCount && state.rows.length" class="zt-dim">· {{ doneCount }} done</span>
      <span class="zt-grow" />
      <span v-if="slowestId && state.status !== 'running'" class="zt-dim">slowest highlighted</span>
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
  gap: 5px;
  font-size: 11px;
  text-transform: capitalize;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--zen-surface-2, #26262d);
  color: var(--zen-muted, #b8b8bf);
}
.zt-status .mdi {
  font-size: 13px;
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
  color: #34d399;
  background: color-mix(in srgb, #34d399 14%, transparent);
}
.zt-status.error {
  color: #f87171;
  background: color-mix(in srgb, #f87171 14%, transparent);
}
@keyframes zt-spin {
  to {
    transform: rotate(360deg);
  }
}
.zt-total {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
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
.zt-empty {
  margin: auto;
  text-align: center;
  color: var(--zen-muted, #76767e);
  max-width: 240px;
  padding: 20px;
}
.zt-empty .mdi {
  font-size: 36px;
  opacity: 0.4;
}
.zt-empty p {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

.zt-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 5px 5px;
  border-radius: 8px;
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
  border-radius: 999px;
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
  border-radius: 8px;
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
  border-radius: 999px;
  background: color-mix(in srgb, var(--zen-text, #fff) 8%, transparent);
  overflow: hidden;
}
.zt-bar {
  height: 100%;
  border-radius: 999px;
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
  background: #f87171;
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
</style>
