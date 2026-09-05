<script setup lang="ts">
// Diagnostics, rendered the same way on a pack's Overview and in the install-wide Issues
// view. Each entry states what's wrong, the evidence, and what to do — a bare severity
// chip isn't much use at 2am.
import type { Issue, IssueLevel } from '@/lib/types'

withDefaults(
  defineProps<{ issues: Issue[]; showPack?: boolean; packLabels?: Record<string, string> }>(),
  {
    showPack: false,
    packLabels: () => ({}),
  },
)
const emit = defineEmits<{ gotoPack: [key: string] }>()

const ICON: Record<IssueLevel, string> = {
  error: 'mdi-alert-octagon',
  warn: 'mdi-alert',
  info: 'mdi-information-outline',
}
const TONE: Record<IssueLevel, string> = { error: 'err', warn: 'warn', info: 'info' }
</script>

<template>
  <div class="il">
    <div v-for="(i, idx) in issues" :key="idx" class="il-item" :class="TONE[i.level]">
      <i class="il-ico mdi" :class="[ICON[i.level], `zi-fg-${TONE[i.level]}`]" />
      <div class="il-body">
        <div class="il-head">
          <span class="il-title">{{ i.title }}</span>
          <button
            v-if="showPack && i.pack"
            class="il-pack"
            :title="`Show ${packLabels[i.pack] ?? i.pack}`"
            @click="emit('gotoPack', i.pack)"
          >
            {{ packLabels[i.pack] ?? i.pack }}
          </button>
          <span v-else-if="showPack" class="zi-chip">install-wide</span>
        </div>
        <div class="il-detail">{{ i.detail }}</div>
        <div v-if="i.hint" class="il-hint">{{ i.hint }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.il {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.il-item {
  display: flex;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--zi-line);
  border-left-width: 2px;
  border-radius: var(--zen-radius, 6px);
  background: var(--zi-fill);
}
.il-item.err {
  border-left-color: var(--zi-err);
}
.il-item.warn {
  border-left-color: var(--zi-warn);
}
.il-item.info {
  border-left-color: var(--zi-info);
}
.il-ico {
  font-size: 14px;
  line-height: 1.3;
  flex: 0 0 auto;
}
.il-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.il-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.il-title {
  font-weight: 600;
}
.il-pack {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  color: var(--zen-accent, #3b82f6);
  cursor: pointer;
}
.il-pack:hover {
  text-decoration: underline;
}
.il-detail {
  color: var(--zen-text, #e6e6ea);
  word-break: break-word;
}
.il-hint {
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
</style>
