<script setup lang="ts">
// ZenLotus — ZenKit's mark, the Full Bloom lotus (docs/assets/render/brand.mjs), in one colour:
// `currentColor`, with opacity carrying the layers. Sized by its width (CSS); `water` adds the
// ripple under it. Alive on request: `bloom()` (exposed; or `interactive` to bloom on click)
// folds the petals in and springs them open with a ripple; `breathing` swells it slowly, for
// "working on it". Under reduced motion nothing moves: the bloom glows, the breath fades.
import { ref } from 'vue'

withDefaults(defineProps<{ water?: boolean; interactive?: boolean; breathing?: boolean }>(), {
  water: false,
  interactive: false,
  breathing: false,
})

const petal = (h: number, w: number) =>
  `M0,0 C${w},${-h * 0.3} ${w * 0.7},${-h * 0.78} 0,${-h} C${-w * 0.7},${-h * 0.78} ${-w},${-h * 0.3} 0,0Z`
const PETALS = [
  { d: petal(54, 24), r: -70, o: 0.35, delay: 0.06 },
  { d: petal(54, 24), r: 70, o: 0.35, delay: 0.06 },
  { d: petal(66, 26), r: -36, o: 0.6, delay: 0.03 },
  { d: petal(66, 26), r: 36, o: 0.6, delay: 0.03 },
  { d: petal(78, 28), r: 0, o: 1, delay: 0 },
]

// each bloom is a fresh key, so a click mid-bloom restarts it
const blooms = ref(0)
function bloom() {
  blooms.value++
}
defineExpose({ bloom })
</script>

<template>
  <svg
    class="zen-lotus"
    :class="{ breathing, interactive }"
    :viewBox="water ? '-60 -84 120 106' : '-60 -84 120 90'"
    fill="currentColor"
    aria-hidden="true"
    @click="interactive && bloom()"
  >
    <g :key="blooms" :class="{ blooming: blooms > 0 }">
      <ellipse v-if="blooms > 0" class="ripple" cx="0" cy="2" rx="40" ry="6" />
      <path
        v-for="(p, i) in PETALS"
        :key="i"
        class="petal"
        :d="p.d"
        :opacity="p.o"
        :style="{ '--r': `${p.r}deg`, animationDelay: `${p.delay}s` }"
      />
    </g>
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
.petal {
  transform: rotate(var(--r));
  transform-origin: 0 0;
  transform-box: view-box;
}
.zen-lotus.interactive {
  cursor: pointer;
}
/* fold in, spring open a little past rest, settle */
.blooming .petal {
  animation: zen-lotus-bloom 0.9s cubic-bezier(0.3, 0, 0.2, 1) both;
}
@keyframes zen-lotus-bloom {
  0% {
    transform: rotate(var(--r)) scale(1);
  }
  28% {
    transform: rotate(calc(var(--r) * 0.12)) scale(0.82, 0.9);
  }
  62% {
    transform: rotate(calc(var(--r) * 1.12)) scale(1.06);
  }
  100% {
    transform: rotate(var(--r)) scale(1);
  }
}
/* a drop on water: the ring spreads and fades under the flower */
.ripple {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  opacity: 0;
  transform-origin: 0 2px;
  transform-box: view-box;
  animation: zen-lotus-ripple 1s ease-out 0.25s both;
}
@keyframes zen-lotus-ripple {
  0% {
    opacity: 0.6;
    transform: scale(0.3);
  }
  100% {
    opacity: 0;
    transform: scale(1.5);
  }
}
/* in, and out: slow, like breathing */
.breathing > g {
  transform-origin: 0 0;
  transform-box: view-box;
  animation: zen-lotus-breathe 4.8s ease-in-out infinite;
}
@keyframes zen-lotus-breathe {
  0%,
  100% {
    transform: scale(0.94);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.04);
    opacity: 1;
  }
}
/* reduced motion: nothing moves; the bloom is a glow and the breath only a fade */
@media (prefers-reduced-motion: reduce) {
  .blooming .petal {
    animation-name: zen-lotus-glow;
  }
  .ripple {
    animation: none;
  }
  .breathing > g {
    animation-name: zen-lotus-fade;
  }
}
:root[data-zen-motion='reduce'] .blooming .petal {
  animation-name: zen-lotus-glow;
}
:root[data-zen-motion='reduce'] .ripple {
  animation: none;
}
:root[data-zen-motion='reduce'] .breathing > g {
  animation-name: zen-lotus-fade;
}
@keyframes zen-lotus-glow {
  0%,
  100% {
    transform: rotate(var(--r));
    filter: none;
  }
  40% {
    transform: rotate(var(--r));
    filter: brightness(1.6) drop-shadow(0 0 6px currentColor);
  }
}
@keyframes zen-lotus-fade {
  0%,
  100% {
    opacity: 0.75;
  }
  50% {
    opacity: 1;
  }
}
</style>
