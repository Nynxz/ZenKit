<script setup lang="ts">
import { openViewer } from '@nynxz/zenkit-client'

import type { Attachment } from '../lib/vision'

const { media } = defineProps<{ media: Attachment }>()

function view(): void {
  void openViewer([{ src: media.url, kind: media.kind, label: media.label ?? media.ref }], { index: 0 })
}
</script>

<template>
  <button class="zt" :title="media.label ?? media.ref" @click="view">
    <video v-if="media.kind === 'video'" :src="media.url" muted playsinline preload="metadata" />
    <i v-else-if="media.kind === 'audio'" class="mdi mdi-music-note" />
    <img v-else :src="media.url" :alt="media.label ?? media.ref" loading="lazy" draggable="false" />
  </button>
</template>

<style scoped>
.zt {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius);
  background: var(--zen-surface);
  color: var(--zen-muted);
  font-size: 20px;
  cursor: zoom-in;
}
.zt img,
.zt video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
