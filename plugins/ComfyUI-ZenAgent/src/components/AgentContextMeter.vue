<script setup lang="ts">
// How full the model's context is: a ring for what the last request filled, and on click, what
// fills it (system prompt, tools, plugin tools, the conversation) and the chat's totals.
import { ZenPopover } from '@nynxz/zenkit-ui'
import { computed } from 'vue'

import type { Usage } from '../lib/api'

const { usage } = defineProps<{ usage: Usage | null }>()

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

const used = computed(() => usage?.last ?? 0)
const share = computed(() => (usage?.context ? Math.min(1, used.value / usage.context) : 0))
const level = computed(() => (share.value > 0.9 ? 'full' : share.value > 0.7 ? 'high' : 'ok'))

const R = 8
const C = 2 * Math.PI * R

/** The last request's tokens by part; the conversation is what the estimates don't cover. */
const segments = computed(() => {
  const parts = usage?.parts
  if (!usage?.last || !parts) return []
  const fixed = parts.system + parts.tools + parts.plugins
  return [
    { label: 'Conversation', value: Math.max(0, usage.last - fixed), cls: 'conv' },
    { label: 'Workflow tools', value: parts.tools, cls: 'tools' },
    { label: 'Plugin tools', value: parts.plugins, cls: 'plugins' },
    { label: 'System and workflow', value: parts.system, cls: 'system' },
  ].filter((s) => s.value > 0)
})
const scale = computed(() => usage?.context || usage?.last || 1)
</script>

<template>
  <ZenPopover placement="bottom-end" role="dialog">
    <template #trigger="{ toggle, active }">
      <button
        class="meter"
        :class="[level, { active }]"
        :title="usage ? 'Context use' : 'Context use appears after the first reply'"
        @click="toggle"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle class="track" cx="10" cy="10" :r="R" />
          <circle class="fill" cx="10" cy="10" :r="R" :stroke-dasharray="`${share * C} ${C}`" />
        </svg>
        <span v-if="usage?.last">
          {{ k(used) }}
          <template v-if="usage.context">/ {{ k(usage.context) }}</template>
        </span>
        <span v-else>Context</span>
      </button>
    </template>
    <div class="pop">
      <template v-if="usage?.last">
        <div class="head">
          <span>Context</span>
          <b v-if="usage.context">{{ Math.round(share * 100) }}% full</b>
        </div>
        <div class="bar">
          <i
            v-for="s in segments"
            :key="s.label"
            :class="s.cls"
            :style="{ width: (s.value / scale) * 100 + '%' }"
          />
        </div>
        <dl class="rows">
          <template v-for="s in segments" :key="s.label">
            <dt>
              <i :class="s.cls" />
              {{ s.label }}
            </dt>
            <dd>~{{ k(s.value) }}</dd>
          </template>
          <template v-if="usage.context">
            <dt>
              <i class="free" />
              Free
            </dt>
            <dd>{{ k(Math.max(0, usage.context - used)) }}</dd>
          </template>
        </dl>
        <div class="totals">
          <span>This chat</span>
          <span>{{ k(usage.input) }} in · {{ k(usage.output) }} out</span>
        </div>
        <p v-if="!usage.context" class="note">
          The endpoint doesn't say how much context the model was loaded with.
        </p>
        <p v-else-if="level !== 'ok'" class="note warn">
          Nearly full: older messages stop fitting. Start a new chat, turn off plugin tools, or load
          the model with more context.
        </p>
      </template>
      <p v-else class="note">Context use shows here after the first reply.</p>
    </div>
  </ZenPopover>
</template>

<style scoped>
.meter {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px 0 7px;
  border: 1px solid var(--zen-control-border, var(--zen-border));
  border-radius: 999px;
  background: var(--zen-control-bg, var(--zen-surface));
  color: var(--zen-muted);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}
.meter:hover,
.meter.active {
  color: var(--zen-text);
  border-color: var(--zen-control-hover-border, var(--zen-accent));
}
svg {
  width: 18px;
  height: 18px;
  transform: rotate(-90deg);
}
circle {
  fill: none;
  stroke-width: 3;
}
.track {
  stroke: var(--zen-surface-2);
}
.fill {
  stroke: var(--zen-accent);
  stroke-linecap: round;
  transition: stroke-dasharray 0.4s ease;
}
.high .fill {
  stroke: var(--zen-warn, #e0a030);
}
.full .fill {
  stroke: var(--zen-danger, #e5484d);
}
.pop {
  width: 280px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px;
  font-size: 12.5px;
}
.head {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}
.head b {
  color: var(--zen-muted);
  font-weight: 500;
}
.bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--zen-surface-2);
}
.bar i {
  height: 100%;
}
.rows {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 10px;
  margin: 0;
}
.rows dt {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--zen-muted);
}
.rows dt i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.rows dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
/* The theme's chart palette, the accent where a theme has none. */
.conv {
  background: var(--chart-1, var(--zen-accent));
}
.tools {
  background: var(--chart-2, color-mix(in srgb, var(--zen-accent) 70%, var(--zen-text)));
}
.plugins {
  background: var(--chart-3, color-mix(in srgb, var(--zen-accent) 45%, var(--zen-text)));
}
.system {
  background: var(--chart-4, var(--zen-muted));
}
.free {
  background: var(--zen-surface-2);
}
.totals {
  display: flex;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--zen-surface-border, var(--zen-border));
  color: var(--zen-muted);
  font-variant-numeric: tabular-nums;
}
.note {
  margin: 0;
  color: var(--zen-muted);
  font-size: 11.5px;
  line-height: 1.45;
}
.note.warn {
  color: var(--zen-warn, #e0a030);
}
</style>
