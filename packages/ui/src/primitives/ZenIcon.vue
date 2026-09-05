<template>
  <!-- Single dynamic root so a parent's class/styles fall through to it. An image
       icon scales to 1em (drops in where an <i> icon was); on load error (or for a
       plain MDI class) it renders the glyph instead. -->
  <component
    :is="showImg ? 'img' : 'i'"
    v-bind="
      showImg ? { src: icon, alt: '', referrerpolicy: 'no-referrer', draggable: 'false' } : {}
    "
    :class="showImg ? 'zen-ico-img' : ['mdi', glyph]"
    @error="onError"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isIconUrl } from '../lib/icon'

const props = withDefaults(defineProps<{ icon?: string | null; fallback?: string }>(), {
  fallback: 'mdi-application-outline',
})

const failed = ref(false)
watch(
  () => props.icon,
  () => (failed.value = false),
) // a new icon gets a fresh try

const url = computed(() => isIconUrl(props.icon))
const showImg = computed(() => url.value && !failed.value)
// fallback glyph when the URL fails; the bare class otherwise (prefixed with 'mdi')
const glyph = computed(() => (url.value ? props.fallback : props.icon || props.fallback))

function onError() {
  if (url.value) failed.value = true // broken favicon/logo → show the glyph
}
</script>

<style scoped>
.zen-ico-img {
  width: 1em;
  height: 1em;
  object-fit: contain;
  display: inline-block;
  vertical-align: -0.15em;
  border-radius: var(--zen-radius, 2px);
}
</style>
