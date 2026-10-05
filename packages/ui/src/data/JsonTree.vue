<script setup lang="ts">
// JsonTree — collapsible JSON viewer, themed with --zen-* tokens.
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    data: unknown
    name?: string // key label for this node
    depth?: number
    defaultOpen?: number // auto-expand down to this depth
  }>(),
  { depth: 0, defaultOpen: 1 },
)

const isArray = computed(() => Array.isArray(props.data))
const isObject = computed(() => props.data !== null && typeof props.data === 'object')
const entries = computed<[string, unknown][]>(() => {
  if (!isObject.value) return []
  if (isArray.value) return (props.data as unknown[]).map((v, i) => [String(i), v])
  return Object.entries(props.data as Record<string, unknown>)
})
const size = computed(() => entries.value.length)
const open = ref(props.depth < props.defaultOpen)

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
const preview = (v: unknown) => {
  const t = typeOf(v)
  if (t === 'string') return `"${v}"`
  if (t === 'array') return `[${(v as unknown[]).length}]`
  if (t === 'object') return `{${Object.keys(v as object).length}}`
  return String(v)
}
</script>

<template>
  <div class="jt" :style="{ marginLeft: depth ? '12px' : '0' }">
    <template v-if="isObject">
      <div class="jt-row" @click="open = !open">
        <i class="mdi jt-caret" :class="open ? 'mdi-menu-down' : 'mdi-menu-right'" />
        <span v-if="name !== undefined" class="jt-key">{{ name }}</span>
        <span class="jt-brace">{{ isArray ? '[' : '{' }}</span>
        <span v-if="!open" class="jt-collapsed">{{ size }}{{ isArray ? ' items' : ' keys' }}</span>
        <span v-if="!open" class="jt-brace">{{ isArray ? ']' : '}' }}</span>
      </div>
      <div v-if="open" class="jt-children">
        <JsonTree
          v-for="[k, v] in entries"
          :key="k"
          :data="v"
          :name="k"
          :depth="depth + 1"
          :default-open="defaultOpen"
        />
        <div class="jt-brace jt-close" :style="{ marginLeft: '12px' }">
          {{ isArray ? ']' : '}' }}
        </div>
      </div>
    </template>
    <div v-else class="jt-row leaf">
      <span v-if="name !== undefined" class="jt-key">{{ name }}</span>
      <span class="jt-val" :class="'t-' + typeOf(data)">{{ preview(data) }}</span>
    </div>
  </div>
</template>

<style scoped>
.jt {
  font-family: var(--zen-mono, ui-monospace, 'SF Mono', Menlo, Consolas, monospace);
  font-size: 11.5px;
  line-height: 1.6;
}
.jt-row {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  white-space: nowrap;
  border-radius: var(--zen-radius, 7px);
}
.jt-row:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 7%, transparent);
}
.jt-row.leaf {
  cursor: default;
}
.jt-caret {
  font-size: 14px;
  color: var(--zen-muted, #9aa0aa);
  margin-left: -2px;
}
.jt-key {
  color: var(--zen-accent, #6366f1);
}
.jt-key::after {
  content: ':';
  color: var(--zen-muted, #9aa0aa);
  margin: 0 2px 0 1px;
}
.jt-brace {
  color: var(--zen-muted, #9aa0aa);
}
.jt-close {
  cursor: default;
}
.jt-collapsed {
  color: var(--zen-muted, #9aa0aa);
  font-style: italic;
  margin: 0 4px;
  opacity: 0.8;
}
.jt-children {
  border-left: 1px solid var(--zen-border, #34343c);
}
.jt-val {
  white-space: pre-wrap;
  word-break: break-word;
}
/* Mixed with the text colour, so they stay readable on light themes as well as dark. */
.t-string {
  color: color-mix(in srgb, #4caf50 70%, var(--zen-text, #e5e5ea));
}
.t-number {
  color: color-mix(in srgb, #d4a017 70%, var(--zen-text, #e5e5ea));
}
.t-boolean {
  color: color-mix(in srgb, #b16ce8 70%, var(--zen-text, #e5e5ea));
}
.t-null {
  color: #9aa0aa;
  font-style: italic;
}
</style>
