<script setup lang="ts">
import { computed } from 'vue'

import { renderMarkdown } from '../lib/markdown'

const { text } = defineProps<{ text: string }>()

// Model output is untrusted: renderMarkdown keeps text formatting only (see lib/markdown.ts).
const html = computed(() => renderMarkdown(text))
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
.za-md :deep(h3),
.za-md :deep(h4) {
  margin: 10px 0 6px;
  font-size: 13px;
}
.za-md :deep(blockquote) {
  margin: 4px 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--zen-surface-border, var(--zen-border));
  color: var(--zen-muted);
}
.za-md :deep(table) {
  margin: 4px 0 8px;
  border-collapse: collapse;
}
.za-md :deep(th),
.za-md :deep(td) {
  padding: 3px 8px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  text-align: left;
}
</style>
