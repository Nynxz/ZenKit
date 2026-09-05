<script setup lang="ts">
// Left column of the master–detail: every pack, grouped by where its code comes from.
// Scrolls on its own (the detail pane has its own scroll), which is what stops a pack with
// 200 nodes from pushing everything else off the panel.
import { computed } from 'vue'
import type { Health, Pack, PackSource } from '@/lib/types'

const props = defineProps<{ packs: Pack[]; selected: string | null }>()
const emit = defineEmits<{ select: [key: string] }>()

const GROUPS: { source: PackSource; label: string }[] = [
  { source: 'custom', label: 'Custom nodepacks' },
  { source: 'core', label: 'ComfyUI core' },
  { source: 'frontend', label: 'Frontend' },
]

const groups = computed(() =>
  GROUPS.map((g) => ({ ...g, packs: props.packs.filter((p) => p.source === g.source) })).filter(
    (g) => g.packs.length,
  ),
)

const dot = (h: Health) => (h === 'error' ? 'err' : h)

// One-line "what state is this in", worst first — the reason you'd be looking at the list.
function sub(p: Pack): string {
  if (p.state === 'failed') return 'import failed'
  if (p.state === 'disabled') return 'disabled'
  const bits: string[] = []
  if (p.nodes.length) bits.push(`${p.nodes.length} node${p.nodes.length > 1 ? 's' : ''}`)
  if (p.web.length) bits.push(`${p.web.length} js`)
  if (p.zen) bits.push('zenkit')
  return bits.join(' · ') || 'no surfaces'
}
</script>

<template>
  <div class="pl">
    <div class="zi-scroll">
      <div v-for="g in groups" :key="g.source" class="pl-group">
        <div class="pl-gh">
          {{ g.label }}
          <span class="zi-num">{{ g.packs.length }}</span>
        </div>
        <button
          v-for="p in g.packs"
          :key="p.key"
          class="pl-row"
          :class="{ on: p.key === selected, dim: p.state === 'disabled' }"
          :title="p.label"
          @click="emit('select', p.key)"
        >
          <span class="zi-dot" :class="dot(p.health)" />
          <span class="pl-txt">
            <span class="pl-name zi-ell">{{ p.label }}</span>
            <span class="pl-sub zi-ell">{{ sub(p) }}</span>
          </span>
          <span v-if="p.issues.length" class="pl-badge" :class="dot(p.health)">
            {{ p.issues.length }}
          </span>
        </button>
      </div>

      <div v-if="!packs.length" class="zi-empty">
        <i class="mdi mdi-filter-remove-outline" />
        <span>Nothing matches the current filter.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pl {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 232px;
  flex: 0 0 auto;
  border-right: 1px solid var(--zi-line);
}
.pl-group {
  padding-bottom: 4px;
}
.pl-gh {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 9px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--zen-muted, #9aa0aa);
  background: var(--zen-surface, #202026);
  border-bottom: 1px solid var(--zi-line);
}
.pl-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.pl-row:hover {
  background: var(--zi-fill);
}
.pl-row.on {
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 16%, transparent);
  border-left-color: var(--zen-accent, #3b82f6);
}
.pl-row.dim {
  opacity: 0.55;
}
.pl-txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.pl-name {
  font-weight: 600;
}
.pl-sub {
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
}
.pl-badge {
  flex: 0 0 auto;
  min-width: 16px;
  text-align: center;
  font-size: 10px;
  border-radius: 999px;
  padding: 0 4px;
  font-variant-numeric: tabular-nums;
  background: var(--zi-fill-2);
  color: var(--zen-muted, #9aa0aa);
}
.pl-badge.err {
  background: color-mix(in srgb, var(--zi-err) 22%, transparent);
  color: var(--zi-err);
}
.pl-badge.warn {
  background: color-mix(in srgb, var(--zi-warn) 22%, transparent);
  color: var(--zi-warn);
}
</style>
