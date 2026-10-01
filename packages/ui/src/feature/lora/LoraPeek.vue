<!-- Enlarged preview beside the hovered LoRA thumb while Shift is held. Mounted once into <body>
     by loraOverlays; never takes pointer events, so it can't steal the hover it follows. -->
<template>
  <div v-if="target && shiftHeld" class="lpk" :style="box" data-zen-layer>
    <div v-if="hasMedia" class="lpk-media">
      <video
        v-if="lib.previewKind(target.name) === 'video'"
        :src="lib.media(target.name)"
        autoplay
        muted
        loop
        playsinline
      />
      <img v-else :src="lib.preview(target.name)" />
    </div>
    <div class="lpk-body">
      <div class="lpk-title">{{ info?.title || lib.short(target.name) }}</div>
      <div class="lpk-chips">
        <span v-if="info?.base_model" class="lpk-chip">{{ info.base_model }}</span>
        <span v-if="info?.version" class="lpk-chip">{{ info.version }}</span>
        <span v-if="strength != null" class="lpk-chip">strength {{ strength }}</span>
      </div>
      <div v-if="info?.trigger_words?.length" class="lpk-words">
        {{ info.trigger_words.join(', ') }}
      </div>
      <div v-if="lib.hasInfo()" class="lpk-hint">Shift+click for details</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import * as lib from './loraLibrary'
import { peekTarget as target, shiftHeld } from './loraState'
import type { LoraInfo } from './types'

const WIDTH = 340
const MAX_HEIGHT = 480
const GAP = 12

const info = ref<LoraInfo | null>(null)

watch(
  () => (shiftHeld.value ? target.value?.name : undefined),
  (name) => {
    info.value = null
    if (!name) return
    void lib.info(name).then((i) => {
      if (target.value?.name === name) info.value = i
    })
  },
)

const hasMedia = computed(() => !!target.value && lib.hasThumb(target.value.name))
const strength = computed(() => info.value?.usage?.strength ?? null)

// Beside the thumb, on whichever side has room; clamped into the viewport.
const box = computed(() => {
  const el = target.value?.el
  if (!el) return {}
  const r = el.getBoundingClientRect()
  let left = r.right + GAP
  if (left + WIDTH > window.innerWidth - 8) left = Math.max(8, r.left - GAP - WIDTH)
  const top = Math.max(8, Math.min(r.top, window.innerHeight - 8 - MAX_HEIGHT))
  return { left: `${left}px`, top: `${top}px`, width: `${WIDTH}px` }
})
</script>

<style scoped>
.lpk {
  position: fixed;
  z-index: 13000;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  max-height: 480px;
  overflow: hidden;
  background: var(--zen-chrome-bg, var(--zen-surface, #202026));
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-surface-border, var(--zen-border, #34343c));
  border-radius: calc(var(--zen-radius-surface, var(--zen-radius, 8px)) + 2px);
  box-shadow: 0 16px 48px rgb(0 0 0 / 55%);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.lpk-media {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  justify-content: center;
  background: var(--zen-input, #1b1b20);
}
.lpk-media img,
.lpk-media video {
  display: block;
  max-width: 100%;
  max-height: 360px;
  object-fit: contain;
}
.lpk-body {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px 9px;
}
.lpk-title {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lpk-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.lpk-chips:empty {
  display: none;
}
.lpk-chip {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 18%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.lpk-words {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lpk-hint {
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
  opacity: 0.8;
}
</style>
