<script setup lang="ts">
// Where VRAM and RAM are going, live: the card's breakdown (model weights, working memory,
// torch's cache, other programs), a two-minute chart, each loaded model with its page-by-page
// residency under dynamic VRAM, and system RAM. Free / unload all go through ComfyUI's own /free;
// unloading one model goes through /zensuite/memory/unload, done on the same execution thread.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ZenEmpty, ZenIconButton, ZenSelect } from '@nynxz/zenkit-ui'
import {
  HISTORY,
  fmtBytes,
  freeMemory,
  memory,
  pageCells,
  pageCounts,
  ramSegments,
  unloadModel,
  vramSegments,
  watchMemory,
  type MemModel,
  type Segment,
} from '@/suite/lib/memory'

const stop = watchMemory(1000)
onBeforeUnmount(stop)

const snap = computed(() => memory.snapshot)
const deviceKey = ref<string | null>(null)
const devices = computed(() => snap.value?.devices ?? [])
watch(
  devices,
  (list) => {
    if (!list.some((d) => d.key === deviceKey.value)) deviceKey.value = list[0]?.key ?? null
  },
  { immediate: true },
)
const device = computed(() => devices.value.find((d) => d.key === deviceKey.value) ?? null)
const tele = computed(() => device.value?.telemetry ?? null)

const vram = computed(() =>
  device.value ? vramSegments(device.value, snap.value?.models ?? []) : [],
)
const vramUsed = computed(() =>
  vram.value.filter((s) => s.key !== 'free').reduce((t, s) => t + s.bytes, 0),
)
const ram = computed(() => (snap.value ? ramSegments(snap.value.ram) : []))
const ramNote = computed(() => {
  const r = snap.value?.ram
  if (!r) return ''
  const swap = r.swap_total
    ? `Swap ${fmtBytes(r.swap_used)} / ${fmtBytes(r.swap_total)}`
    : 'No swap'
  return r.pinned_max ? `Pinning limit ${fmtBytes(r.pinned_max)} · ${swap}` : swap
})
const ramUsed = computed(() => (snap.value ? snap.value.ram.total - snap.value.ram.available : 0))

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)
const shown = (segs: Segment[]) => segs.filter((s) => s.bytes > 0)

const models = computed(() =>
  [...(snap.value?.models ?? [])]
    .sort((a, b) => Number(b.in_use) - Number(a.in_use) || b.loaded - a.loaded)
    .map((m) => ({ ...m, pagesShown: residencyOf(m) })),
)
const KIND_ICON: Record<MemModel['kind'], string> = {
  diffusion: 'mdi-cube-outline',
  text: 'mdi-format-text',
  vae: 'mdi-image-filter-center-focus',
  other: 'mdi-shape-outline',
}
const CELLS = 96
function residencyOf(m: MemModel) {
  const r = m.residency
  if (!r?.pages) return null
  const counts = pageCounts(r.pages)
  return {
    cells: pageCells(r.pages, CELLS),
    counts,
    watermark: r.watermark != null && m.size ? Math.min(100, pct(r.watermark, m.size)) : null,
  }
}

// The chart: VRAM in use as a filled area (against the card's total), GPU load as a line.
const W = 240
const H = 48
const history = computed(() => (deviceKey.value ? (memory.history[deviceKey.value] ?? []) : []))
const x = (i: number) => (i / (HISTORY - 1)) * W
const offset = computed(() => HISTORY - history.value.length)
const usedPath = computed(() => {
  const total = device.value?.total || 1
  const pts = history.value.map(
    (s, i) => `${x(i + offset.value).toFixed(1)},${(H - (s.used / total) * H).toFixed(1)}`,
  )
  if (!pts.length) return ''
  return `M${x(offset.value).toFixed(1)},${H} L${pts.join(' L')} L${W},${H} Z`
})
const utilPath = computed(() => {
  const pts = history.value.flatMap((s, i) =>
    s.util == null
      ? []
      : [`${x(i + offset.value).toFixed(1)},${(H - (s.util / 100) * H).toFixed(1)}`],
  )
  return pts.length > 1 ? `M${pts.join(' L')}` : ''
})

/** Models asked to unload, until they leave the list (after the running prompt, if any). */
const unloading = ref(new Set<string>())
async function unload(id: string) {
  unloading.value = new Set(unloading.value).add(id)
  await unloadModel(id)
}
watch(
  () => snap.value?.models,
  (list) => {
    const here = new Set((list ?? []).map((m) => m.id))
    const left = [...unloading.value].filter((id) => here.has(id))
    if (left.length !== unloading.value.size) unloading.value = new Set(left)
  },
)

const busy = ref<'free' | 'unload' | null>(null)
async function free(clearCache: boolean) {
  busy.value = clearCache ? 'free' : 'unload'
  try {
    await freeMemory({ clearCache })
  } finally {
    window.setTimeout(() => (busy.value = null), 600)
  }
}

const deviceOptions = computed(() =>
  devices.value.map((d) => ({ value: d.key, label: `${d.key} · ${d.name}` })),
)
</script>

<template>
  <div class="zm">
    <div class="zm-top">
      <span v-if="device" class="zm-total" :title="`${device.name}: VRAM in use / total`">
        {{ fmtBytes(vramUsed) }}
        <span class="zm-of">/ {{ fmtBytes(device.total) }}</span>
      </span>
      <span v-else class="zm-dim">{{ snap ? 'No GPU' : 'Loading…' }}</span>
      <span v-if="tele?.util != null" class="zm-chip" title="GPU load">
        <i class="mdi mdi-speedometer" />
        {{ tele.util }}%
      </span>
      <span
        v-if="tele?.temp != null"
        class="zm-chip temp"
        :class="{ hot: tele.temp >= 83 }"
        title="GPU temperature"
      >
        <i class="mdi mdi-thermometer" />
        {{ tele.temp }}°
      </span>
      <span
        v-if="tele?.power != null"
        class="zm-chip power"
        :title="
          tele.power_limit ? `Power draw (limit ${Math.round(tele.power_limit)} W)` : 'Power draw'
        "
      >
        <i class="mdi mdi-flash-outline" />
        {{ Math.round(tele.power) }} W
      </span>
      <span class="zm-grow" />
      <ZenIconButton
        icon="mdi mdi-eject-outline"
        title="Unload all models (after the running prompt, if any)"
        :active="busy === 'unload'"
        @click="free(false)"
      />
      <ZenIconButton
        icon="mdi mdi-broom"
        title="Free everything: unload all models and forget cached node outputs, so the next run computes every node again"
        :active="busy === 'free'"
        @click="free(true)"
      />
    </div>

    <div class="zm-body">
      <ZenEmpty v-if="memory.error && !snap">Couldn't read memory: {{ memory.error }}</ZenEmpty>

      <section v-if="device" class="zm-sect">
        <div class="zm-head">
          <span class="zm-label">VRAM</span>
          <ZenSelect
            v-if="devices.length > 1"
            size="sm"
            :model-value="device.key"
            :options="deviceOptions"
            @update:model-value="(v) => (deviceKey = v as string)"
          />
          <span v-else class="zm-dim zm-ellipsis" :title="device.name">{{ device.name }}</span>
        </div>
        <div class="zm-bar">
          <div
            v-for="s in shown(vram)"
            :key="s.key"
            class="zm-seg"
            :class="s.key"
            :style="{ width: pct(s.bytes, device.total) + '%' }"
            :title="`${s.label}: ${fmtBytes(s.bytes)}`"
          />
        </div>
        <div class="zm-legend">
          <span v-for="s in shown(vram)" :key="s.key" class="zm-key">
            <i class="zm-sw" :class="s.key" />
            <span class="zm-klabel">{{ s.label }}</span>
            <span class="zm-kval">{{ fmtBytes(s.bytes) }}</span>
          </span>
        </div>
        <svg
          class="zm-chart"
          :viewBox="`0 0 ${W} ${H}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path v-if="usedPath" :d="usedPath" class="zm-area" />
          <path v-if="utilPath" :d="utilPath" class="zm-line" />
        </svg>
        <div class="zm-chartkey zm-dim">
          <span>
            <i class="zm-sw weights" />
            VRAM in use
          </span>
          <span v-if="utilPath">
            <i class="zm-sw line" />
            GPU load
          </span>
          <span class="zm-grow" />
          <span>last 2 min</span>
        </div>
      </section>

      <section class="zm-sect">
        <div class="zm-head">
          <span class="zm-label">Models</span>
          <span class="zm-count">{{ models.length }}</span>
        </div>
        <ZenEmpty v-if="snap && !models.length">No models loaded.</ZenEmpty>
        <div v-for="m in models" :key="m.id" class="zm-model" :class="{ idle: !m.in_use }">
          <div class="zm-mhead">
            <i class="mdi zm-mico" :class="KIND_ICON[m.kind]" />
            <span class="zm-mname" :title="`${m.name} on ${m.device}`">{{ m.name }}</span>
            <span v-if="m.in_use" class="zm-badge on" title="Used by the current or last prompt">
              in use
            </span>
            <span class="zm-grow" />
            <span class="zm-mval">
              {{ fmtBytes(m.loaded) }}
              <span class="zm-dim">/ {{ fmtBytes(m.size) }}</span>
            </span>
            <ZenIconButton
              size="sm"
              icon="mdi mdi-eject-outline"
              :title="
                unloading.has(m.id)
                  ? 'Unloading after the running prompt, if any'
                  : `Unload ${m.name}`
              "
              :active="unloading.has(m.id)"
              :disabled="unloading.has(m.id)"
              @click="unload(m.id)"
            />
          </div>
          <template v-if="m.pagesShown">
            <div class="zm-pages" :title="'Each cell is a slice of the model\'s 32 MB pages'">
              <i v-for="(c, i) in m.pagesShown!.cells" :key="i" class="zm-page" :class="c" />
              <span
                v-if="m.pagesShown!.watermark != null"
                class="zm-water"
                :style="{ left: m.pagesShown!.watermark + '%' }"
                title="aimdo's watermark for this model"
              />
            </div>
            <div class="zm-mfoot zm-dim">
              <span>
                <i class="zm-sw vram" />
                {{ m.pagesShown!.counts.vram + m.pagesShown!.counts.both }} in VRAM
              </span>
              <span>
                <i class="zm-sw pinned" />
                {{ m.pagesShown!.counts.pinned + m.pagesShown!.counts.both }} pinned
              </span>
              <span>
                <i class="zm-sw absent" />
                {{ m.pagesShown!.counts.absent }} on disk
              </span>
            </div>
          </template>
          <div v-else class="zm-track">
            <div class="zm-fill" :style="{ width: pct(m.loaded, m.size) + '%' }" />
          </div>
        </div>
      </section>

      <section v-if="snap" class="zm-sect">
        <div class="zm-head">
          <span class="zm-label">System RAM</span>
          <span class="zm-dim">{{ fmtBytes(ramUsed) }} / {{ fmtBytes(snap.ram.total) }}</span>
        </div>
        <div class="zm-bar">
          <div
            v-for="s in shown(ram)"
            :key="s.key"
            class="zm-seg"
            :class="['ram', s.key]"
            :style="{ width: pct(s.bytes, snap.ram.total) + '%' }"
            :title="`${s.label}: ${fmtBytes(s.bytes)}`"
          />
        </div>
        <div class="zm-legend">
          <span v-for="s in shown(ram)" :key="s.key" class="zm-key">
            <i class="zm-sw" :class="['ram', s.key]" />
            <span class="zm-klabel">{{ s.label }}</span>
            <span class="zm-kval">{{ fmtBytes(s.bytes) }}</span>
          </span>
        </div>
        <div class="zm-note zm-dim">
          {{ ramNote }}
        </div>
      </section>
    </div>

    <div class="zm-foot">
      <span
        class="zm-status"
        :class="{ running: snap?.running }"
        :title="snap?.running ? 'A prompt is running' : 'Idle'"
      >
        <i class="mdi" :class="snap?.running ? 'mdi-loading' : 'mdi-pause'" />
      </span>
      <span v-if="snap" class="zm-dim">
        {{ snap.aimdo.enabled ? 'Dynamic VRAM' : 'Dynamic VRAM off' }}
        <template v-if="snap.aimdo.enabled && snap.aimdo.version">
          · aimdo {{ snap.aimdo.version }}
        </template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.zm {
  container-type: inline-size;
  --zm-weights: var(--zen-accent, #8b8bf5);
  --zm-working: color-mix(in srgb, var(--zen-accent, #8b8bf5) 55%, var(--zen-info, #38bdf8));
  --zm-cache: color-mix(in srgb, var(--zen-accent, #8b8bf5) 35%, transparent);
  --zm-other: color-mix(in srgb, var(--zen-text, #e5e5e8) 32%, transparent);
  --zm-free: color-mix(in srgb, var(--zen-text, #fff) 7%, transparent);
  --zm-pinned: var(--zen-warn, #f59e0b);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--zen-text, #e5e5e8);
  font-size: 13px;
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zm-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--zen-border, #34343c);
  min-width: 0;
}
.zm-total {
  font-family: ui-monospace, monospace;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.zm-of {
  font-size: 12px;
  font-weight: 500;
  color: var(--zen-muted, #9a9aa2);
}
.zm-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 2px 7px 2px 5px;
  border-radius: var(--zen-radius, 8px);
  font-size: 11px;
  font-family: ui-monospace, monospace;
  background: var(--zen-surface-2, #26262d);
  color: var(--zen-muted, #b8b8bf);
}
.zm-chip .mdi {
  font-size: 12px;
}
@container (max-width: 360px) {
  .zm-chip.power {
    display: none;
  }
}
@container (max-width: 330px) {
  .zm-chip.temp:not(.hot) {
    display: none;
  }
}
.zm-chip.hot {
  color: var(--zen-danger);
  background: color-mix(in srgb, var(--zen-danger) 14%, transparent);
}
.zm-grow {
  flex: 1;
}
.zm-dim {
  color: var(--zen-muted, #9a9aa2);
}
.zm-ellipsis {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-gutter: stable;
}
.zm-sect {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 9px 9px;
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-text, #fff) 4%, transparent);
}
.zm-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}
.zm-label {
  font-weight: 600;
  flex: 0 0 auto;
}
.zm-count {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
  color: var(--zen-muted, #9a9aa2);
}
.zm-bar {
  display: flex;
  height: 12px;
  border-radius: calc(var(--zen-radius, 8px) / 2);
  overflow: hidden;
  background: var(--zm-free);
}
.zm-seg {
  height: 100%;
  min-width: 2px;
  transition: width 0.35s ease;
}
.zm-seg + .zm-seg {
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--zen-bg, #18181b) 60%, transparent);
}
.weights {
  background: var(--zm-weights);
}
.working {
  background: var(--zm-working);
}
.cache {
  background: var(--zm-cache);
}
.other {
  background: var(--zm-other);
}
.free {
  background: var(--zm-free);
}
.ram.weights {
  background: var(--zm-pinned);
}
.ram.working {
  background: var(--zm-weights);
}
.zm-legend {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 3px 12px;
  font-size: 11px;
}
.zm-key {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.zm-klabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--zen-muted, #9a9aa2);
}
.zm-kval {
  font-family: ui-monospace, monospace;
}
.zm-sw {
  display: inline-block;
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: calc(var(--zen-radius, 8px) / 4);
  margin-right: 4px;
  vertical-align: -0.5px;
}
.zm-key .zm-sw {
  margin-right: 0;
}
.zm-sw.line {
  height: 2px;
  background: var(--zen-ok, #22c55e);
  vertical-align: 2px;
}
.zm-chart {
  width: 100%;
  height: 48px;
  display: block;
  border-radius: calc(var(--zen-radius, 8px) / 2);
  background: color-mix(in srgb, var(--zen-text, #fff) 3%, transparent);
}
.zm-area {
  fill: color-mix(in srgb, var(--zm-weights) 35%, transparent);
  stroke: var(--zm-weights);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.zm-line {
  fill: none;
  stroke: var(--zen-ok, #22c55e);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.zm-chartkey,
.zm-mfoot {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10px;
}
.zm-note {
  font-size: 11px;
}
.zm-model {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 7px;
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-text, #fff) 4%, transparent);
}
.zm-model.idle {
  opacity: 0.75;
}
.zm-mhead {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}
.zm-mico {
  color: var(--zen-accent, #8b8bf5);
  font-size: 13px;
}
.zm-mname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.zm-badge {
  flex: 0 0 auto;
  font-size: 9px;
  padding: 1px 6px;
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
  color: var(--zen-muted, #9a9aa2);
}
.zm-badge.on {
  color: var(--zen-ok);
  background: color-mix(in srgb, var(--zen-ok) 14%, transparent);
}
.zm-mval {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.zm-track {
  height: 4px;
  border-radius: calc(var(--zen-radius, 8px) / 4);
  background: var(--zm-free);
  overflow: hidden;
}
.zm-fill {
  height: 100%;
  background: var(--zm-weights);
  transition: width 0.35s ease;
}
.zm-pages {
  position: relative;
  display: flex;
  gap: 1px;
  height: 10px;
}
.zm-page {
  flex: 1;
  min-width: 1px;
  border-radius: calc(var(--zen-radius, 8px) / 8);
}
.zm-page.absent,
.zm-sw.absent {
  background: var(--zm-free);
}
.zm-page.vram,
.zm-sw.vram {
  background: var(--zm-weights);
}
.zm-page.pinned,
.zm-sw.pinned {
  background: var(--zm-pinned);
}
.zm-page.both {
  background: linear-gradient(var(--zm-weights) 60%, var(--zm-pinned) 60%);
}
.zm-water {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  margin-left: -1px;
  border-radius: calc(var(--zen-radius, 8px) / 8);
  background: var(--zen-text, #e5e5e8);
}
.zm-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--zen-border, #34343c);
  font-size: 11px;
  min-width: 0;
}
.zm-status {
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
.zm-status .mdi {
  display: block;
  width: 13px;
  height: 13px;
  font-size: 13px;
  line-height: 13px;
}
.zm-status.running {
  color: var(--zen-accent, #8b8bf5);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 16%, transparent);
}
.zm-status.running .mdi {
  animation: zm-spin 0.8s linear infinite;
}
@keyframes zm-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
