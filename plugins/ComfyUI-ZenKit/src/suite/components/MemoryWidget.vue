<script setup lang="ts">
// The taskbar's memory meter: the main card's use as a small bar and a figure. Clicking it opens
// a quick look (the VRAM breakdown, system RAM, what's loaded, unload all) with a way through to
// the full Memory panel. Polls slowly while closed, every second while open, and not at all
// while the page is hidden.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getZenKit } from '@nynxz/zenkit-client'
import { ZenIconButton, ZenPopover } from '@nynxz/zenkit-ui'
import {
  fmtBytes,
  freeMemory,
  memory,
  ramSegments,
  vramSegments,
  watchMemory,
} from '@/suite/lib/memory'

const stop = watchMemory(3000)
let stopFast: (() => void) | null = null
const open = ref(false)
watch(open, (on) => {
  stopFast?.()
  stopFast = on ? watchMemory(1000) : null
})
onBeforeUnmount(() => {
  stop()
  stopFast?.()
})

const snap = computed(() => memory.snapshot)
const device = computed(() => snap.value?.devices[0] ?? null)
const segments = computed(() =>
  device.value ? vramSegments(device.value, snap.value?.models ?? []) : [],
)
const ram = computed(() => snap.value?.ram ?? null)
const ramSegs = computed(() => (ram.value ? ramSegments(ram.value) : []))
const sum = (segs: { key: string; bytes: number }[]) =>
  segs.filter((s) => s.key !== 'free').reduce((t, s) => t + s.bytes, 0)
const vramUsed = computed(() => sum(segments.value))
const ramUsed = computed(() => (ram.value ? ram.value.total - ram.value.available : 0))
/** VRAM on a GPU; system RAM where there's none. */
const used = computed(() => (device.value ? vramUsed.value : ramUsed.value))
const total = computed(() => device.value?.total ?? ram.value?.total ?? 0)
const share = computed(() => (total.value ? used.value / total.value : 0))
const pct = (bytes: number, of: number) => (of ? Math.min(100, (bytes / of) * 100) : 0)

const models = computed(() => snap.value?.models ?? [])
const modelsLoaded = computed(() => models.value.reduce((t, m) => t + m.loaded, 0))
const tele = computed(() => device.value?.telemetry ?? null)

const title = computed(() => {
  if (!total.value) return memory.error ? `Memory: ${memory.error}` : 'Memory'
  const what = device.value ? device.value.name : 'System RAM'
  return `${what}: ${fmtBytes(used.value)} / ${fmtBytes(total.value)}`
})

const unloading = ref(false)
async function unloadAll() {
  unloading.value = true
  try {
    await freeMemory({ clearCache: false })
  } finally {
    window.setTimeout(() => (unloading.value = false), 600)
  }
}
function openPanel(close: () => void) {
  close()
  getZenKit()?.panels.open('zensuite:memory')
}
</script>

<template>
  <ZenPopover v-model:open="open" placement="top-end" :offset="8" role="dialog">
    <template #trigger="{ toggle, active }">
      <button
        class="zmw"
        :class="{ on: active, high: share >= 0.9, none: !total, error: !total && memory.error }"
        :title="title"
        @click="toggle"
      >
        <i class="mdi" :class="!total && memory.error ? 'mdi-alert-outline' : 'mdi-memory'" />
        <span class="zmw-bar">
          <span class="zmw-fill" :style="{ width: pct(used, total) + '%' }" />
        </span>
        <span v-if="total" class="zmw-val">{{ fmtBytes(used) }}</span>
      </button>
    </template>

    <template #default="{ close }">
      <div class="zmp">
        <div class="zmp-top">
          <span class="zmp-title">Memory</span>
          <ZenIconButton
            size="sm"
            icon="mdi mdi-eject-outline"
            :title="
              unloading
                ? 'Unloading after the running prompt, if any'
                : 'Unload all models (after the running prompt, if any)'
            "
            :active="unloading"
            :disabled="!models.length || unloading"
            @click="unloadAll"
          />
          <ZenIconButton
            size="sm"
            icon="mdi mdi-open-in-new"
            title="Open the Memory panel"
            @click="openPanel(close)"
          />
        </div>
        <div v-if="!snap" class="zmp-empty">
          {{ memory.error ? `Couldn't read memory: ${memory.error}` : 'Reading memory…' }}
        </div>
        <template v-else>
          <section v-if="device" class="zmp-sect">
            <div class="zmp-head">
              <span class="zmp-name" :title="device.key">{{ device.name }}</span>
              <span class="zmp-fig">
                {{ fmtBytes(vramUsed) }}
                <span class="zmp-dim">/ {{ fmtBytes(device.total) }}</span>
              </span>
            </div>
            <div class="zmp-bar">
              <span
                v-for="s in segments.filter((s) => s.key !== 'free' && s.bytes > 0)"
                :key="s.key"
                class="zmp-seg"
                :class="s.key"
                :style="{ width: pct(s.bytes, device.total) + '%' }"
              />
            </div>
            <div class="zmp-rows">
              <div v-for="s in segments.filter((s) => s.bytes > 0)" :key="s.key" class="zmp-row">
                <i class="zmp-sw" :class="s.key" />
                <span>{{ s.label }}</span>
                <span class="zmp-val">{{ fmtBytes(s.bytes) }}</span>
              </div>
            </div>
            <div v-if="tele && (tele.util != null || tele.temp != null)" class="zmp-dim zmp-note">
              <span v-if="tele.util != null">{{ tele.util }}% load</span>
              <span v-if="tele.temp != null">{{ tele.temp }}°C</span>
              <span v-if="tele.power != null">{{ Math.round(tele.power) }} W</span>
            </div>
          </section>

          <section v-if="ram" class="zmp-sect">
            <div class="zmp-head">
              <span class="zmp-name">System RAM</span>
              <span class="zmp-fig">
                {{ fmtBytes(ramUsed) }}
                <span class="zmp-dim">/ {{ fmtBytes(ram.total) }}</span>
              </span>
            </div>
            <div class="zmp-bar">
              <span
                v-for="s in ramSegs.filter((s) => s.key !== 'free' && s.bytes > 0)"
                :key="s.key"
                class="zmp-seg"
                :class="s.key"
                :style="{ width: pct(s.bytes, ram.total) + '%' }"
                :title="`${s.label}: ${fmtBytes(s.bytes)}`"
              />
            </div>
          </section>

          <section class="zmp-sect zmp-models">
            <span v-if="models.length">
              {{ models.length }} model{{ models.length === 1 ? '' : 's' }} loaded
              <span class="zmp-dim">· {{ fmtBytes(modelsLoaded) }}</span>
            </span>
            <span v-else class="zmp-dim">No models loaded</span>
          </section>
        </template>
      </div>
    </template>
  </ZenPopover>
</template>

<style scoped>
.zmw {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--zen-radius, 8px);
  background: transparent;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
  cursor: pointer;
}
.zmw:hover,
.zmw.on {
  background: var(--zen-control-hover-bg, var(--zen-surface-2, #27272e));
  color: var(--zen-text, #e5e5ea);
}
.zmw .mdi {
  font-size: 15px;
}
.zmw-bar {
  position: relative;
  width: 38px;
  height: 5px;
  border-radius: calc(var(--zen-radius, 8px) / 2);
  overflow: hidden;
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
}
.zmw-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--zen-accent, #8b8bf5);
  transition: width 0.35s ease;
}
.zmw.high .zmw-fill {
  background: var(--zen-danger);
}
.zmw.none .zmw-bar {
  opacity: 0.4;
}
.zmw.error {
  color: var(--zen-warn, var(--zen-danger));
}
.zmw-val {
  font-family: ui-monospace, monospace;
  min-width: 52px;
  text-align: left;
}

/* The popover is teleported out of the taskbar, so it carries its own colours. */
.zmp {
  --zm-weights: var(--zen-accent, #8b8bf5);
  --zm-working: color-mix(in srgb, var(--zen-accent, #8b8bf5) 55%, var(--zen-info, #38bdf8));
  --zm-cache: color-mix(in srgb, var(--zen-accent, #8b8bf5) 35%, transparent);
  --zm-other: color-mix(in srgb, var(--zen-text, #e5e5e8) 32%, transparent);
  --zm-free: color-mix(in srgb, var(--zen-text, #fff) 7%, transparent);
  width: 280px;
  padding: 4px;
  font-size: 12px;
  color: var(--zen-text, #e5e5ea);
}
.zmp-empty {
  padding: 10px 6px;
  color: var(--zen-muted, #9aa0aa);
}
.zmp-sect {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
}
.zmp-sect + .zmp-sect {
  border-top: 1px solid var(--zen-border, #34343c);
}
.zmp-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.zmp-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.zmp-fig,
.zmp-val {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.zmp-title {
  flex: 1 1 auto;
}
.zmp-dim {
  color: var(--zen-muted, #9aa0aa);
}
.zmp-bar {
  display: flex;
  height: 8px;
  border-radius: calc(var(--zen-radius, 8px) / 2);
  overflow: hidden;
  background: var(--zm-free);
}
.zmp-seg {
  height: 100%;
  min-width: 2px;
  transition: width 0.35s ease;
}
.zmp-seg + .zmp-seg {
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--zen-bg, #18181b) 60%, transparent);
}
.zmp-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}
.zmp-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zmp-row .zmp-val {
  margin-left: auto;
}
.zmp-sw {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: calc(var(--zen-radius, 8px) / 4);
}
.zmp-note {
  display: flex;
  gap: 10px;
  font-size: 11px;
}
.zmp-models {
  font-size: 11px;
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
.zmp-top {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 0 2px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--zen-muted, #9aa0aa);
}
</style>
