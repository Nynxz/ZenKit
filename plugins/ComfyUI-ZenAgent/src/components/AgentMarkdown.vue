<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed } from 'vue'

const { text } = defineProps<{ text: string }>()

// Model output is untrusted, so the rendered HTML is sanitised before it reaches the page.
const html = computed(() => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true })))
</script>

<template>
  <div class="za-md" v-html="html" />
</template>

<style scoped>
.za-md {
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.za-md :deep(p) {
  margin: 0 0 8px;
}
.za-md :deep(p:last-child) {
  margin-bottom: 0;
}
.za-md :deep(ul),
.za-md :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 20px;
}
.za-md :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--zen-text) 9%, transparent);
  font-family: var(--zen-mono);
  font-size: 11.5px;
}
.za-md :deep(pre) {
  margin: 6px 0 10px;
  padding: 10px 12px;
  overflow-x: auto;
  border-radius: var(--zen-radius);
  background: color-mix(in srgb, var(--zen-text) 7%, transparent);
}
.za-md :deep(pre code) {
  padding: 0;
  background: none;
}
.za-md :deep(a) {
  color: var(--zen-accent);
}
.za-md :deep(h1),
.za-md :deep(h2),
.za-md :deep(h3) {
  margin: 10px 0 6px;
  font-size: 13px;
}
</style>
