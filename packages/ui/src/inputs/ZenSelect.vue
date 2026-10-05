<script setup lang="ts">
// ZenSelect — custom dropdown (v-model). Fully themed (native <select>'s option
// popup can't be styled) and the menu is teleported to <body> with fixed coords so
// it escapes the panel's overflow:hidden. options: strings or {value,label,icon}.
import '../lib/scrollbar.css'
import { computed, onBeforeUnmount, ref } from 'vue'
import { iconClass } from '../lib/icon'
import { inOtherLayer, openLayer, Z, type Layer } from '../overlays/layers'
type Val = string
type Opt = Val | { value: Val; label?: string; icon?: string }
const props = defineProps<{
  modelValue: Val
  options: Opt[]
  placeholder?: string
  disabled?: boolean
  /** `sm` 24px, `md` (default) 28px — the shared control heights. */
  size?: 'sm' | 'md'
}>()
const emit = defineEmits<{ 'update:modelValue': [Val] }>()
const norm = (o: Opt) => (typeof o === 'object' ? o : { value: o, label: String(o) })

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const current = computed(() => props.options.map(norm).find((o) => o.value === props.modelValue))

function onDoc(e: PointerEvent) {
  const t = e.target as Node
  if (
    root.value?.contains(t) ||
    menuRef.value?.contains(t) ||
    inOtherLayer(e.target, menuRef.value)
  )
    return
  close()
}
let layer: Layer | null = null
const z = ref<number>(Z.popover)
function onKey(e: KeyboardEvent) {
  if (layer?.escape(e)) close()
}
// Close on scroll/resize so the fixed-position menu never detaches from its
// trigger — but ignore scrolling *inside* the menu itself.
function onScroll(e: Event) {
  if (menuRef.value?.contains(e.target as Node)) return
  close()
}
function openMenu() {
  const trig = root.value?.querySelector('.zs-trigger') as HTMLElement | null
  if (trig) {
    const r = trig.getBoundingClientRect()
    const estH = Math.min(260, props.options.length * 30 + 10)
    const below = window.innerHeight - r.bottom
    // open upward when there isn't room below and there's more room above (e.g. the bottom taskbar)
    const flipUp = below < estH + 8 && r.top > below
    menuStyle.value = flipUp
      ? {
          bottom: window.innerHeight - r.top + 4 + 'px',
          left: r.left + 'px',
          minWidth: r.width + 'px',
        }
      : { top: r.bottom + 4 + 'px', left: r.left + 'px', minWidth: r.width + 'px' }
  }
  open.value = true
  layer ??= openLayer(Z.popover)
  z.value = layer.z
  setTimeout(() => {
    window.addEventListener('pointerdown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
  }, 0)
}
function close() {
  if (!open.value) return
  open.value = false
  layer?.release()
  layer = null
  window.removeEventListener('pointerdown', onDoc, true)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', close)
}
function pick(v: Val) {
  emit('update:modelValue', v)
  close()
}
onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="zen-select" :class="{ open, sm: size === 'sm' }">
    <button
      type="button"
      class="zs-trigger"
      :disabled="disabled"
      @click="open ? close() : openMenu()"
    >
      <i v-if="current?.icon" class="zs-ico" :class="iconClass(current.icon)" />
      <span class="zs-label">{{ current?.label ?? current?.value ?? placeholder ?? '' }}</span>
      <i class="mdi mdi-menu-down zs-caret" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="menuRef"
        data-zen-layer
        class="zs-menu zen-scroll"
        :style="[menuStyle, { zIndex: z }]"
        role="listbox"
      >
        <button
          v-for="o in options"
          :key="String(norm(o).value)"
          type="button"
          class="zs-opt"
          :class="{ on: norm(o).value === modelValue }"
          role="option"
          :aria-selected="norm(o).value === modelValue"
          @click="pick(norm(o).value)"
        >
          <i v-if="norm(o).icon" class="zs-ico" :class="iconClass(norm(o).icon)" />
          <span>{{ norm(o).label ?? norm(o).value }}</span>
          <i v-if="norm(o).value === modelValue" class="mdi mdi-check zs-check" />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Floor so the control can never collapse to unusable — see the note in ZenColorPicker. Comfort
   is ZenRow's flex-basis (which can wrap); this only stops it vanishing. */
.zen-select {
  position: relative;
  display: inline-flex;
  min-width: var(--zen-control-min, 90px);
}
/* `flex: 1` so the trigger FILLS the root when a layout stretches it. Without it the root grows
   and the trigger stays at content width, leaving the control visibly narrower than its slot. */
.zs-trigger {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  box-sizing: border-box;
  height: var(--zen-control-h, 28px);
  padding: 0 6px 0 8px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  background: var(--zen-control-bg, var(--zen-surface, #202026));
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-control-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius, 7px);
  transition: border-color 0.12s ease;
}
.zen-select.sm .zs-trigger {
  height: var(--zen-control-h-sm, 24px);
  font-size: 11px;
}
.zs-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.zs-trigger:hover,
.zen-select.open .zs-trigger {
  border-color: var(--zen-control-hover-border, var(--zen-accent, #6366f1));
  background: var(--zen-control-hover-bg, var(--zen-control-bg));
}
.zs-trigger:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
}
.zs-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}
.zs-caret {
  font-size: 16px;
  color: var(--zen-muted, #9aa0aa);
  flex: 0 0 auto;
}
.zs-ico {
  font-size: 14px;
  flex: 0 0 auto;
}
.zs-menu {
  position: fixed;
  z-index: 100000;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--zen-chrome-bg, var(--zen-surface, #202026));
  border: 1px solid var(--zen-surface-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 7px));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zs-opt {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  color: var(--zen-text, #e5e5ea);
  border-radius: max(0px, calc(var(--zen-radius, 7px) - 3px));
  white-space: nowrap;
}
.zs-opt span {
  flex: 1;
}
.zs-opt:hover {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 10%, transparent);
}
.zs-opt:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: -2px;
}
.zs-opt.on {
  color: var(--zen-accent, #6366f1);
}
.zs-check {
  font-size: 14px;
  color: var(--zen-accent, #6366f1);
  flex: 0 0 auto;
}
</style>
