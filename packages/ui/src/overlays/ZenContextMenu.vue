<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuEl"
      data-zen-layer
      class="zen-ctx zen-surface zen-scroll"
      role="menu"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px`, zIndex: z }"
      @contextmenu.prevent
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item === '-'" class="zen-ctx-sep" />
        <div v-else-if="'heading' in item" class="zen-ctx-head">{{ item.heading }}</div>
        <button
          v-else
          type="button"
          class="zen-ctx-item"
          :class="{ danger: item.danger }"
          :disabled="item.disabled"
          role="menuitem"
          @click="pick(item)"
        >
          <i class="mdi" :class="item.icon ? iconClass(item.icon) : 'zen-ctx-blank'" />
          <span>{{ item.label }}</span>
          <kbd v-if="item.hint">{{ item.hint }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// ZenContextMenu — a right-click menu at the pointer. Pass `items` and call `show(event)` from a
// contextmenu handler; it opens where the pointer is, keeps itself on screen, and closes on a pick,
// Escape, or a click anywhere else.
import '../lib/scrollbar.css'
import '../lib/surface.css'
import { nextTick, onBeforeUnmount, reactive, ref } from 'vue'

import { iconClass } from '../lib/icon'
import { inOtherLayer, openLayer, Z, type Layer } from './layers'

export interface ContextMenuAction {
  label: string
  icon?: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  run: () => void
}
export type ContextMenuItem = ContextMenuAction | { heading: string } | '-'

defineProps<{ items: ContextMenuItem[] }>()

const open = ref(false)
const menuEl = ref<HTMLElement | null>(null)
const pos = reactive({ x: 0, y: 0 })
const z = ref<number>(Z.popover)
let layer: Layer | null = null

function onDoc(e: PointerEvent) {
  if (menuEl.value?.contains(e.target as Node) || inOtherLayer(e.target, menuEl.value)) return
  close()
}
function onKey(e: KeyboardEvent) {
  if (layer?.escape(e)) close()
}

async function show(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  pos.x = e.clientX
  pos.y = e.clientY
  layer ??= openLayer(Z.popover)
  z.value = layer.z
  open.value = true
  await nextTick()
  const r = menuEl.value?.getBoundingClientRect()
  if (r) {
    pos.x = Math.min(pos.x, window.innerWidth - r.width - 6)
    pos.y = Math.min(pos.y, window.innerHeight - r.height - 6)
  }
  setTimeout(() => {
    window.addEventListener('pointerdown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
  }, 0)
}
function close() {
  if (!open.value) return
  open.value = false
  layer?.release()
  layer = null
  window.removeEventListener('pointerdown', onDoc, true)
  window.removeEventListener('keydown', onKey, true)
}
function pick(item: ContextMenuAction) {
  close()
  item.run()
}
onBeforeUnmount(close)
defineExpose({ show, close })
</script>

<style scoped>
.zen-ctx {
  position: fixed;
  z-index: 100000;
  min-width: 190px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 4px;
  font-size: 12px;
}
.zen-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.zen-ctx-item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 22%, transparent);
}
.zen-ctx-item:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: -2px;
}
.zen-ctx-item:disabled {
  opacity: 0.4;
  cursor: default;
}
.zen-ctx-item.danger {
  color: var(--zen-danger, #dc2626);
}
.zen-ctx-item .mdi {
  width: 16px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 14px;
  text-align: center;
}
.zen-ctx-item span {
  flex: 1;
}
.zen-ctx-item kbd {
  color: var(--zen-muted, #9aa0aa);
  font-family: inherit;
  font-size: 10.5px;
}
.zen-ctx-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--zen-surface-border, var(--zen-border, #34343c));
}
.zen-ctx-head {
  padding: 5px 8px 3px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
