<script setup lang="ts">
// ZenModal — teleported centered overlay dialog (v-model:open). Backdrop click + Esc
// close. `header`/default/`footer` slots. Sized via width/height props (CSS values).
import { onBeforeUnmount, watch } from 'vue'
import '../lib/scrollbar.css'

const props = withDefaults(
  defineProps<{ open: boolean; title?: string; width?: string; height?: string }>(),
  { width: '720px', height: '70vh' },
)
const emit = defineEmits<{ 'update:open': [boolean] }>()

function close() {
  emit('update:open', false)
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.open,
  (o) => {
    if (o) window.addEventListener('keydown', onKey, true)
    else window.removeEventListener('keydown', onKey, true)
  },
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="zen-modal-back" @pointerdown.self="close">
      <div class="zen-modal" :style="{ width, height }">
        <div class="zm-head">
          <span v-if="title" class="zm-title">{{ title }}</span>
          <div class="zm-head-mid"><slot name="header" /></div>
          <button class="zm-x" title="Close" @click="close"><i class="mdi mdi-close" /></button>
        </div>
        <div class="zm-body zen-scroll"><slot /></div>
        <div v-if="$slots.footer" class="zm-foot"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style>
/* Not scoped — teleported to <body>; reads --zen-* tokens. */
.zen-modal-back {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.zen-modal {
  display: flex;
  flex-direction: column;
  max-width: 94vw;
  max-height: 90vh;
  overflow: hidden;
  background: var(--zen-surface, #202026);
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-border, #34343c);
  border-radius: calc(var(--zen-radius, 8px) + 2px);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zen-modal .zm-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--zen-border, #34343c);
  flex: none;
}
.zen-modal .zm-title {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.zen-modal .zm-head-mid {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.zen-modal .zm-x {
  border: none;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  font-size: 18px;
  display: inline-flex;
}
.zen-modal .zm-x:hover {
  color: var(--zen-text, #e5e5ea);
}
.zen-modal .zm-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.zen-modal .zm-foot {
  flex: none;
  border-top: 1px solid var(--zen-border, #34343c);
  padding: 10px 14px;
}
</style>
