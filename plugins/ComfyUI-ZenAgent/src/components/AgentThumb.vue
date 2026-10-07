<script setup lang="ts">
import { openViewer } from '@nynxz/zenkit-client'
import { ref, watchEffect } from 'vue'

import type { Attachment } from '../lib/vision'
import { autoLoads, resolveMedia } from '../lib/vision'

const { media } = defineProps<{ media: Attachment }>()

// Saved threads keep only the ref, and anything stored may have been written by someone else, so
// the picture comes from an inline image or a URL ZenKit's media sources build for the ref, on
// this ComfyUI. Anything else shows an icon rather than loading by itself.
const src = ref<string | null>(null)
watchEffect(async () => {
  const { ref: mediaRef, url } = media
  src.value = url && autoLoads(url) ? url : null
  if (src.value) return
  const built = await resolveMedia(mediaRef).catch(() => null)
  if (media.ref === mediaRef && built && autoLoads(built.url, true)) src.value = built.url
})

function view(): void {
  if (!src.value) return
  void openViewer([{ src: src.value, kind: media.kind, label: media.label ?? media.ref }], {
    index: 0,
  })
}
</script>

<template>
  <button class="zt" :class="{ inert: !src }" :title="media.label ?? media.ref" @click="view">
    <video v-if="src && media.kind === 'video'" :src="src" muted playsinline preload="metadata" />
    <i v-else-if="media.kind === 'audio'" class="mdi mdi-music-note" />
    <img
      v-else-if="src"
      :src="src"
      :alt="media.label ?? media.ref"
      loading="lazy"
      draggable="false"
    />
    <i v-else class="mdi mdi-image-off-outline" />
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
.zt.inert {
  cursor: default;
}
.zt img,
.zt video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
