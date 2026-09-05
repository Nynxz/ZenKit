<template>
  <div v-if="jobs.length" class="zjt">
    <div v-for="job in jobs" :key="job.id" class="zjt-card" :class="job.status">
      <div class="zjt-head">
        <i class="mdi" :class="iconOf(job.status)" />
        <span class="zjt-name">{{ job.name }}</span>
        <span class="zjt-pct">{{ pct(job) }}%</span>
      </div>
      <div class="zjt-bar">
        <div :style="{ width: pct(job) + '%' }" />
      </div>
      <div class="zjt-foot">
        <span>{{ labelOf(job) }}</span>
        <span v-if="job.message">{{ job.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Job, JobStatus } from '@nynxz/zenkit-types'
import { jobsState } from '../jobs'

const jobs = computed(() =>
  Object.values(jobsState.byId)
    // Stable ordering: cards should update in place, not jump around whenever
    // progress events arrive. Newer jobs sit nearest the taskbar at the bottom.
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    .slice(-4),
)

function pct(job: Pick<Job, 'current' | 'total' | 'status'>): number {
  if (job.total <= 0) return job.status === 'done' ? 100 : 0
  return Math.min(100, Math.round((job.current / job.total) * 100))
}

function labelOf(job: Job): string {
  if (job.status === 'done') return 'Complete'
  if (job.status === 'error') return 'Failed'
  return job.total > 0 ? `${job.current} / ${job.total}` : job.status
}

function iconOf(status: JobStatus): string {
  if (status === 'done') return 'mdi-check-circle-outline'
  if (status === 'error') return 'mdi-alert-circle-outline'
  return 'mdi-loading mdi-spin'
}
</script>

<style scoped>
.zjt {
  position: fixed;
  right: 12px;
  bottom: 44px;
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(340px, calc(100vw - 24px));
  pointer-events: none;
}
.zjt-card {
  pointer-events: auto;
  padding: 10px;
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 8px);
  background: color-mix(in srgb, var(--zen-surface, #202026) 94%, transparent);
  color: var(--zen-text, #e5e5ea);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(10px);
}
.zjt-card.done {
  border-color: color-mix(in srgb, #34d399 42%, var(--zen-border, #3a3a44));
}
.zjt-card.error {
  border-color: color-mix(in srgb, #f87171 48%, var(--zen-border, #3a3a44));
}
.zjt-head,
.zjt-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.zjt-head {
  margin-bottom: 7px;
}
.zjt-head .mdi {
  flex: none;
  color: var(--zen-accent, #3b82f6);
  font-size: 15px;
}
.zjt-card.done .zjt-head .mdi {
  color: #34d399;
}
.zjt-card.error .zjt-head .mdi {
  color: #f87171;
}
.zjt-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font:
    600 12px system-ui,
    sans-serif;
}
.zjt-pct {
  flex: none;
  color: var(--zen-muted, #9aa0aa);
  font:
    11px system-ui,
    sans-serif;
}
.zjt-bar {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--zen-input, #15151a);
}
.zjt-bar div {
  height: 100%;
  border-radius: inherit;
  background: var(--zen-accent, #3b82f6);
  transition: width 0.12s linear;
}
.zjt-card.done .zjt-bar div {
  background: #34d399;
}
.zjt-card.error .zjt-bar div {
  background: #f87171;
}
.zjt-foot {
  justify-content: space-between;
  margin-top: 6px;
  color: var(--zen-muted, #9aa0aa);
  font:
    11px system-ui,
    sans-serif;
}
.zjt-foot span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
