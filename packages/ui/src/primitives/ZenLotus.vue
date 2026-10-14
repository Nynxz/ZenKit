<script setup lang="ts">
// ZenLotus — ZenKit's mark, the Full Bloom lotus (docs/assets/render/brand.mjs), in one colour:
// `currentColor`, with opacity carrying the layers. Sized by its width (CSS); `water` adds the
// ripple under it.
withDefaults(defineProps<{ water?: boolean }>(), { water: false })

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
  <svg
    class="zen-lotus"
    :viewBox="water ? '-60 -84 120 106' : '-60 -84 120 90'"
    fill="currentColor"
    aria-hidden="true"
  >
    <path v-for="(p, i) in PETALS" :key="i" :d="p.d" :transform="`rotate(${p.r})`" :opacity="p.o" />
    <ellipse v-if="water" cx="0" cy="12" rx="44" ry="5" opacity="0.45" />
  </svg>
</template>

<style scoped>
.zen-lotus {
  display: inline-block;
  flex: none;
  width: 1.2em;
  overflow: visible;
}
</style>
