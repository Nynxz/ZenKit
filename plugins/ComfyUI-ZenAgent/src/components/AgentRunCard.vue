<script setup lang="ts">
import { getZenKit, openViewer } from '@nynxz/zenkit-client'
import { computed, onBeforeUnmount, ref } from 'vue'

import type { Run } from '../lib/runs'
import { restoreRun, runs } from '../lib/runs'

const { promptIds } = defineProps<{ promptIds: string[] }>()
for (const id of promptIds) void restoreRun(id).catch(() => null)

const list = computed(() => promptIds.map((id) => runs[id]).filter((r): r is Run => !!r))
const isActive = (r: Run) => r.status === 'queued' || r.status === 'running'
const active = computed(() => list.value.filter(isActive))
const failed = computed(() =>
  list.value.filter((r) => r.status === 'error' || r.status === 'interrupted'),
)
const status = computed(() => {
  if (active.value.length) return 'running'
  return failed.value.length ? 'error' : 'done'
})

// A clock for the elapsed time while any run is going; stops with them.
const now = ref(Date.now())
const tick = window.setInterval(() => (now.value = Date.now()), 250)
onBeforeUnmount(() => window.clearInterval(tick))

const elapsed = computed(() => {
  if (!list.value.length) return ''
  const start = Math.min(...list.value.map((r) => r.startedAt))
  const end = active.value.length
    ? now.value
    : Math.max(...list.value.map((r) => r.finishedAt ?? r.startedAt))
  return `${((end - start) / 1000).toFixed(1)}s`
})

const title = computed(() => {
  const total = list.value.length
  const finished = total - active.value.length
  const running = active.value.find((r) => r.status === 'running')
  if (total === 1) {
    const only = list.value[0]!
    if (only.status === 'queued') return 'Queued'
    if (only.status === 'running') return only.node ? `Running ${only.node}` : 'Running'
    if (only.status === 'done') return 'Finished'
    return only.status === 'interrupted' ? 'Interrupted' : 'Failed'
  }
  if (active.value.length) {
    const head = `${finished} of ${total} done`
    return running?.node ? `${head} · ${running.node}` : head
  }
  return failed.value.length
    ? `${total - failed.value.length} of ${total} finished · ${failed.value.length} failed`
    : `${total} runs finished`
})

function fill(r: Run): number | null {
  if (!isActive(r)) return 100
  const p = r.progress
  return p && p.max > 0 ? Math.round((p.value / p.max) * 100) : null
}

const errors = computed(() => [...new Set(failed.value.map((r) => r.error).filter(Boolean))])
const media = computed(() => list.value.flatMap((r) => r.outputs).filter((o) => o.kind !== 'audio'))

function view(index: number): void {
  void openViewer(
    media.value.map((o) => ({ src: o.url, kind: o.kind, label: o.filename })),
    { index },
  )
}

const sending = ref(false)
const canSend = computed(() => !!getZenKit()?.capabilities.get('viewer.show'))
async function toViewer(): Promise<void> {
  sending.value = true
  const title = list.value.length > 1 ? `${list.value.length} runs` : undefined
  await getZenKit()
    ?.capabilities.run('viewer.show', { media: media.value.map((o) => o.ref), title })
    .finally(() => (sending.value = false))
}
</script>

<template>
  <div v-if="list.length" class="zr" :class="status">
    <div class="zr-head">
      <span class="zr-icon">
        <Transition name="zr-pop" mode="out-in">
          <i v-if="status === 'running'" key="busy" class="mdi mdi-loading mdi-spin" />
          <i v-else-if="status === 'done'" key="done" class="mdi mdi-check-circle" />
          <i v-else key="bad" class="mdi mdi-alert-circle" />
        </Transition>
      </span>
      <span class="zr-title">{{ title }}</span>
      <span class="zr-time">{{ elapsed }}</span>
      <button
        v-if="canSend && media.length && status !== 'running'"
        class="zr-open"
        title="Open in a Media Viewer panel"
        :disabled="sending"
        @click="toViewer"
      >
        <i class="mdi mdi-open-in-new" />
      </button>
    </div>
    <div class="zr-bar" :class="{ settled: status !== 'running' }">
      <span v-for="r in list" :key="r.promptId" class="zr-seg" :class="r.status">
        <span
          :class="{ indeterminate: fill(r) === null }"
          :style="fill(r) === null ? undefined : { width: fill(r) + '%' }"
        />
      </span>
    </div>
    <div v-for="error in errors" :key="error!" class="zr-error">{{ error }}</div>
    <TransitionGroup v-if="media.length" tag="div" name="zr-thumb" class="zr-grid">
      <button
        v-for="(o, i) in media"
        :key="o.url"
        class="zr-thumb"
        :title="o.filename"
        @click="view(i)"
      >
        <video v-if="o.kind === 'video'" :src="o.url" muted loop autoplay playsinline />
        <img v-else :src="o.url" :alt="o.filename" loading="lazy" />
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.zr {
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: calc(var(--zen-radius) + 2px);
  background: color-mix(in srgb, var(--zen-text) 3%, var(--zen-bg));
  overflow: hidden;
  animation: zr-in 0.3s ease both;
}
.zr-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}
.zr-icon {
  display: inline-flex;
  font-size: 16px;
  color: var(--zen-accent);
}
.zr.done .zr-icon {
  color: var(--zen-ok);
}
.zr.error .zr-icon,
.zr.interrupted .zr-icon,
.zr-error {
  color: var(--zen-danger);
}
.zr-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zr-time {
  color: var(--zen-muted);
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
}
.zr-bar {
  display: flex;
  gap: 3px;
  margin: 0 10px 10px;
  transition: opacity 0.4s ease;
}
.zr-bar.settled {
  opacity: 0.55;
}
.zr-seg {
  position: relative;
  flex: 1;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, var(--zen-text) 12%, transparent);
}
.zr-seg > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--zen-accent);
  transition:
    width 0.3s ease,
    background-color 0.3s ease;
}
.zr-seg.done > span {
  background: var(--zen-ok);
}
.zr-seg:is(.error, .interrupted) > span {
  background: var(--zen-danger);
}
.zr-seg > span.indeterminate {
  width: 30%;
  animation: zr-slide 1.1s ease-in-out infinite;
}
.zr-open {
  display: inline-flex;
  padding: 2px 4px;
  border: 0;
  border-radius: var(--zen-radius);
  background: none;
  color: var(--zen-muted);
  font-size: 14px;
  cursor: pointer;
}
.zr-open:hover {
  background: color-mix(in srgb, var(--zen-text) 8%, transparent);
  color: var(--zen-text);
}
.zr-error {
  padding: 0 10px 10px;
  font-size: 11.5px;
}
.zr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 6px;
  padding: 0 10px 10px;
}
.zr-thumb {
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius);
  background: var(--zen-surface);
  cursor: zoom-in;
}
.zr-thumb img,
.zr-thumb video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.25s ease;
}
.zr-thumb:hover img,
.zr-thumb:hover video {
  transform: scale(1.04);
}
.zr-thumb-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.zr-thumb-enter-from {
  opacity: 0;
  transform: scale(0.92);
}
.zr-pop-enter-active,
.zr-pop-leave-active {
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}
.zr-pop-enter-from {
  transform: scale(0.4);
  opacity: 0;
}
.zr-pop-leave-to {
  transform: scale(1.4);
  opacity: 0;
}
@keyframes zr-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
@keyframes zr-slide {
  from {
    left: -30%;
  }
  to {
    left: 100%;
  }
}
</style>
