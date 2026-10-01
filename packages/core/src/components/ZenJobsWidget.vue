<template>
  <ZenPopover placement="top-end" :offset="8">
    <template #trigger="{ toggle, active }">
      <button
        class="zjw-chip"
        :class="{ on: active, busy: phase === 'busy', [phase]: true }"
        :title="summary"
        @click="toggle"
      >
        <svg class="zjw-ring" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="track" cx="12" cy="12" :r="RING_R" />
          <circle
            class="fill"
            :class="{ indeterminate: ringPct === null }"
            cx="12"
            cy="12"
            :r="RING_R"
            :stroke-dasharray="RING_C"
            :stroke-dashoffset="ringPct === null ? RING_C * 0.72 : RING_C * (1 - ringPct / 100)"
          />
        </svg>
        <i class="mdi zjw-icon rest mdi-format-list-checks" />
        <i class="mdi zjw-icon done mdi-check" />
        <i class="mdi zjw-icon failed mdi-alert-circle-outline" />
        <span class="zjw-count" :class="{ shown: running.length > 1 }">{{ running.length }}</span>
      </button>
    </template>
    <div class="zjw-pop">
      <div class="zjw-head">
        <span>Jobs</span>
        <button
          class="zjw-clear"
          :class="{ hidden: !finished.length }"
          :tabindex="finished.length ? 0 : -1"
          @click="clearFinishedJobs"
        >
          Clear finished
        </button>
      </div>
      <div v-if="!ordered.length" class="zjw-empty">No running or recent jobs.</div>
      <!-- Fixed-height rows in a stable newest-first order: finishing changes a row's colours,
           never its size or position. -->
      <div v-for="job in ordered" :key="job.id" class="zjw-job" :class="job.status">
        <i class="mdi zjw-job-icon" :class="iconOf(job)" />
        <span class="zjw-name">{{ job.name }}</span>
        <span class="zjw-state">{{ stateOf(job) }}</span>
        <span class="zjw-msg">{{ job.message || job.source || '' }}</span>
        <span class="zjw-line">
          <span
            :class="{ indeterminate: !isFinished(job) && pct(job) === null }"
            :style="
              !isFinished(job) && pct(job) === null
                ? undefined
                : { width: (isFinished(job) ? 100 : pct(job)) + '%' }
            "
          />
        </span>
      </div>
    </div>
  </ZenPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ZenPopover } from '@nynxz/zenkit-ui'
import type { Job } from '@nynxz/zenkit-types'
import { clearFinishedJobs, jobsState } from '../jobs'

const isFinished = (job: Job) => job.status === 'done' || job.status === 'error'

const jobs = computed(() => Object.values(jobsState.byId))
const running = computed(() =>
  jobs.value.filter((j) => !isFinished(j)).sort((a, b) => a.startedAt - b.startedAt),
)
const finished = computed(() =>
  jobs.value.filter(isFinished).sort((a, b) => b.updatedAt - a.updatedAt),
)
const failed = computed(() => finished.value.some((j) => j.status === 'error'))
const ordered = computed(() => [...jobs.value].sort((a, b) => b.startedAt - a.startedAt))

function pct(job: Job): number | null {
  if (job.total <= 0) return null
  return Math.min(100, Math.round((job.current / job.total) * 100))
}

/** Progress across the running jobs that report a total; null when none do. */
const overall = computed(() => {
  const counted = running.value.filter((j) => j.total > 0)
  if (!counted.length) return null
  const done = counted.reduce((sum, j) => sum + Math.min(j.current, j.total), 0)
  const total = counted.reduce((sum, j) => sum + j.total, 0)
  return Math.round((done / total) * 100)
})

// One fixed-size icon, so the taskbar never shifts: a ring around it fills with progress while
// jobs run (or spins when none report a total), a badge counts them, and when they all finish
// it shows a check briefly — or an alert while a failed job is still in the recent list.
const RING_R = 10.5
const RING_C = 2 * Math.PI * RING_R
// The chip moves through phases with crossfades rather than snapping: busy (the ring) holds for
// at least MIN_BUSY_MS so an instant job doesn't flicker, the ring fills to the end as it
// finishes, then the check (or the alert) shows before it rests again.
const MIN_BUSY_MS = 600
const SETTLE_MS = 2500
type Phase = 'rest' | 'busy' | 'done' | 'failed'
const shownBusy = ref(false)
const settling = ref(false)
let busySince = 0
let timer = 0
watch(
  () => running.value.length > 0,
  (busy) => {
    window.clearTimeout(timer)
    if (busy) {
      if (!shownBusy.value) busySince = Date.now()
      shownBusy.value = true
      settling.value = false
      return
    }
    if (!shownBusy.value) return
    timer = window.setTimeout(
      () => {
        shownBusy.value = false
        settling.value = true
        timer = window.setTimeout(() => (settling.value = false), SETTLE_MS)
      },
      Math.max(0, MIN_BUSY_MS - (Date.now() - busySince)),
    )
  },
)
const phase = computed<Phase>(() => {
  if (shownBusy.value) return 'busy'
  if (failed.value) return 'failed'
  return settling.value ? 'done' : 'rest'
})
// Holds the last progress while busy lingers, and reads full once the jobs have finished.
let lastPct: number | null = null
const ringPct = computed(() => {
  if (running.value.length) return (lastPct = overall.value)
  return shownBusy.value ? 100 : lastPct
})
const summary = computed(() => {
  const n = running.value.length
  if (n === 1) {
    const only = running.value[0]!
    const p = pct(only)
    return p === null ? `${only.name} — working…` : `${only.name} — ${p}%`
  }
  if (n) return overall.value === null ? `${n} jobs running` : `${n} jobs — ${overall.value}%`
  if (failed.value) return 'A job failed — click for details'
  return finished.value.length ? 'Jobs — recent' : 'Jobs'
})

function iconOf(job: Job): string {
  if (job.status === 'done') return 'mdi-check-circle-outline'
  if (job.status === 'error') return 'mdi-alert-circle-outline'
  return 'mdi-loading mdi-spin'
}

function stateOf(job: Job): string {
  if (job.status === 'done') return 'Done'
  if (job.status === 'error') return 'Failed'
  const p = pct(job)
  return p === null ? 'Working…' : `${job.current} / ${job.total}`
}
</script>

<style scoped>
.zjw-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--zen-radius, 8px);
  background: transparent;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  transition: color 0.2s ease;
}
.zjw-chip:hover,
.zjw-chip.on {
  background: var(--zen-control-hover-bg, var(--zen-surface-2, #27272e));
  color: var(--zen-text, #e5e5ea);
}
.zjw-chip.busy {
  color: var(--zen-text, #e5e5ea);
}
.zjw-chip.done {
  color: var(--zen-ok);
}
.zjw-chip.failed {
  color: var(--zen-danger);
}
.zjw-icon {
  position: absolute;
  font-size: 16px;
  line-height: 1;
  opacity: 0;
  transform: scale(0.7);
  transition:
    opacity 0.28s ease,
    transform 0.28s ease,
    font-size 0.28s ease;
}
.zjw-chip.busy .zjw-icon.rest {
  font-size: 12px;
}
.zjw-chip:is(.rest, .busy) .zjw-icon.rest,
.zjw-chip.done .zjw-icon.done,
.zjw-chip.failed .zjw-icon.failed {
  opacity: 1;
  transform: none;
}
.zjw-ring {
  position: absolute;
  inset: 1px 2px;
  width: 24px;
  height: 24px;
  transform: rotate(-90deg) scale(0.85);
  opacity: 0;
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.zjw-chip.busy .zjw-ring {
  opacity: 1;
  transform: rotate(-90deg);
}
.zjw-ring circle {
  fill: none;
  stroke-width: 2;
}
.zjw-ring .track {
  stroke: color-mix(in srgb, var(--zen-text, #fff) 16%, transparent);
}
.zjw-ring .fill {
  stroke: var(--zen-accent, #3b82f6);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.35s ease;
}
.zjw-ring .fill.indeterminate {
  transform-origin: 12px 12px;
  animation: zjw-spin 1s linear infinite;
}
@keyframes zjw-spin {
  to {
    transform: rotate(360deg);
  }
}
.zjw-count {
  position: absolute;
  opacity: 0;
  transform: scale(0.6);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
  top: -2px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}
.zjw-count.shown {
  opacity: 1;
  transform: none;
}
@keyframes zjw-slide {
  from {
    left: -35%;
  }
  to {
    left: 100%;
  }
}
.zjw-pop {
  width: 320px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  font-size: 12px;
  color: var(--zen-text, #e5e5ea);
}
.zjw-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 8px;
  font-weight: 600;
}
.zjw-clear {
  border: 0;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-weight: 400;
  cursor: pointer;
}
.zjw-empty {
  padding: 10px 6px 12px;
  color: var(--zen-muted, #9aa0aa);
}
.zjw-clear.hidden {
  visibility: hidden;
}
.zjw-clear:hover {
  color: var(--zen-text, #e5e5ea);
}
.zjw-job {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  grid-template-rows: 18px 16px;
  column-gap: 8px;
  align-items: center;
  height: 42px;
  padding: 4px 6px 6px;
  border-top: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
}
.zjw-job-icon {
  grid-row: 1 / span 2;
  font-size: 15px;
  text-align: center;
  transition: color 0.25s ease;
}
.zjw-name,
.zjw-msg {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zjw-state {
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: color 0.25s ease;
}
.zjw-msg {
  grid-column: 2 / span 2;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.zjw-line {
  position: absolute;
  left: 30px;
  right: 6px;
  bottom: 3px;
  height: 2px;
  overflow: hidden;
  border-radius: 1px;
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.zjw-line > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--zen-accent, #3b82f6);
  transition:
    width 0.3s ease,
    background-color 0.25s ease,
    opacity 0.4s ease;
}
.zjw-line > span.indeterminate {
  width: 35%;
  animation: zjw-slide 1.1s ease-in-out infinite;
}
.zjw-job.done .zjw-line > span {
  background: var(--zen-ok);
  opacity: 0.55;
}
.zjw-job.error .zjw-line > span {
  background: var(--zen-danger);
  opacity: 0.55;
}
.zjw-job.done .zjw-job-icon {
  color: var(--zen-ok);
}
.zjw-job.error .zjw-job-icon,
.zjw-job.error .zjw-state {
  color: var(--zen-danger);
}
</style>
