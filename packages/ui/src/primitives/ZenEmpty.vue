<script setup lang="ts">
// ZenEmpty — the "nothing here yet" state for a panel or list: a faint mark, an optional
// title, a line of guidance (default slot) and an optional `actions` slot. The mark is ZenKit's
// lotus in one colour unless `icon` (MDI class or image URL) names something more specific.
// Centres itself in whatever flex/grid parent it sits in.
import ZenIcon from './ZenIcon.vue'

defineProps<{ title?: string; icon?: string }>()

// The Full Bloom lotus (docs/assets/render/brand.mjs), single colour: opacity carries the layers.
const petal = (h: number, w: number) =>
  `M0,0 C${w},${-h * 0.3} ${w * 0.7},${-h * 0.78} 0,${-h} C${-w * 0.7},${-h * 0.78} ${-w},${-h * 0.3} 0,0Z`
const PETALS = [
  { d: petal(54, 24), r: -70, o: 0.35 },
  { d: petal(54, 24), r: 70, o: 0.35 },
  { d: petal(66, 26), r: -36, o: 0.6 },
  { d: petal(66, 26), r: 36, o: 0.6 },
  { d: petal(78, 28), r: 0, o: 1 },
]
</script>

<template>
  <div class="zen-empty" role="status">
    <ZenIcon v-if="icon" class="zen-empty-mark zen-empty-icon" :icon="icon" />
    <svg v-else class="zen-empty-mark" viewBox="-60 -84 120 106" aria-hidden="true">
      <path
        v-for="(p, i) in PETALS"
        :key="i"
        :d="p.d"
        :transform="`rotate(${p.r})`"
        :opacity="p.o"
      />
      <ellipse cx="0" cy="12" rx="44" ry="5" opacity="0.45" />
    </svg>
    <div v-if="title" class="zen-empty-title">{{ title }}</div>
    <p v-if="$slots.default" class="zen-empty-text"><slot /></p>
    <div v-if="$slots.actions" class="zen-empty-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.zen-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 20px;
  text-align: center;
  color: var(--zen-muted, #9aa0aa);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zen-empty-mark {
  width: 44px;
  margin-bottom: 4px;
  fill: currentColor;
  opacity: 0.45;
}
.zen-empty-icon {
  width: auto;
  font-size: 36px;
}
.zen-empty-title {
  color: var(--zen-text, #e5e5ea);
  font-size: 13px;
  font-weight: 600;
}
.zen-empty-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.zen-empty-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
</style>
