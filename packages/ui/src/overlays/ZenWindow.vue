<script setup lang="ts">
// ZenWindow — a reusable, runtime-free floating panel: draggable + resizable, maximize,
// screen-clamped, teleported to <body>, with ZenKit-style glass chrome. Node tools (e.g.
// ZenMaskEditor) wrap their content in this instead of each re-rolling window chrome, so
// every tool shares one consistent panel. No ZenKit-runtime dependency — pure @nynxz/zenkit-ui.
//
//   Slots: `actions` (header buttons, before maximize/close) · default (body) · `footer`.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ZenIconButton from '../primitives/ZenIconButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    icon?: string
    /** Preferred initial size (px); clamped to the viewport. 0 = auto from viewport. */
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    /** Dim + block the area behind the window (modal). Default false = modeless: clicks
     *  outside the window pass through, so the app behind stays interactive. */
    backdrop?: boolean
    /** Esc closes the window. */
    closeOnEsc?: boolean
  }>(),
  {
    title: '',
    icon: 'mdi mdi-application-outline',
    width: 0,
    height: 0,
    minWidth: 420,
    minHeight: 320,
    backdrop: false,
    closeOnEsc: true,
  },
)
const emit = defineEmits<{ 'update:open': [boolean]; maximize: [boolean] }>()

const winX = ref(0)
const winY = ref(0)
const winW = ref(900)
const winH = ref(640)
const maximized = ref(false)
const winStyle = computed(() =>
  maximized.value
    ? { left: '14px', top: '14px', width: 'calc(100vw - 28px)', height: 'calc(100vh - 28px)' }
    : {
        left: winX.value + 'px',
        top: winY.value + 'px',
        width: winW.value + 'px',
        height: winH.value + 'px',
      },
)

function init() {
  const dw = props.width || Math.round(window.innerWidth * 0.7)
  const dh = props.height || Math.round(window.innerHeight * 0.82)
  winW.value = Math.max(props.minWidth, Math.min(dw, window.innerWidth - 24))
  winH.value = Math.max(props.minHeight, Math.min(dh, window.innerHeight - 24))
  winX.value = Math.max(8, Math.round((window.innerWidth - winW.value) / 2))
  winY.value = Math.max(8, Math.round((window.innerHeight - winH.value) / 2))
  maximized.value = false
}
function clampToViewport() {
  if (maximized.value) return
  winW.value = Math.min(winW.value, window.innerWidth - 16)
  winH.value = Math.min(winH.value, window.innerHeight - 16)
  winX.value = Math.max(0, Math.min(winX.value, window.innerWidth - winW.value))
  winY.value = Math.max(0, Math.min(winY.value, window.innerHeight - winH.value))
}
function startDrag(e: PointerEvent) {
  if (maximized.value || (e.target as HTMLElement).closest('.zw-no-drag')) return
  e.preventDefault()
  const ox = e.clientX - winX.value
  const oy = e.clientY - winY.value
  const move = (m: PointerEvent) => {
    winX.value = Math.max(0, Math.min(window.innerWidth - winW.value, m.clientX - ox))
    winY.value = Math.max(0, Math.min(window.innerHeight - winH.value, m.clientY - oy))
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function startResize(e: PointerEvent) {
  e.preventDefault()
  const sx = e.clientX
  const sy = e.clientY
  const sw = winW.value
  const sh = winH.value
  const move = (m: PointerEvent) => {
    winW.value = Math.max(
      props.minWidth,
      Math.min(window.innerWidth - winX.value, sw + (m.clientX - sx)),
    )
    winH.value = Math.max(
      props.minHeight,
      Math.min(window.innerHeight - winY.value, sh + (m.clientY - sy)),
    )
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function toggleMax() {
  maximized.value = !maximized.value
  emit('maximize', maximized.value)
}
function close() {
  emit('update:open', false)
}
function onKey(e: KeyboardEvent) {
  if (props.closeOnEsc && e.key === 'Escape') {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    close()
  }
}
watch(
  () => props.open,
  (o) => {
    if (o) {
      init()
      window.addEventListener('resize', clampToViewport)
      window.addEventListener('keydown', onKey)
    } else {
      window.removeEventListener('resize', clampToViewport)
      window.removeEventListener('keydown', onKey)
    }
  },
)
onBeforeUnmount(() => {
  window.removeEventListener('resize', clampToViewport)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="zw-root" :class="{ 'zw-backdrop': backdrop }">
      <div class="zw" :class="{ max: maximized }" :style="winStyle">
        <header class="zw-bar" @pointerdown="startDrag" @dblclick="toggleMax">
          <i class="zw-icon" :class="icon" />
          <span class="zw-title">{{ title }}</span>
          <span class="zw-grow" />
          <span class="zw-actions zw-no-drag" @pointerdown.stop><slot name="actions" /></span>
          <span class="zw-no-drag" @pointerdown.stop>
            <ZenIconButton
              :icon="maximized ? 'mdi mdi-window-restore' : 'mdi mdi-window-maximize'"
              :title="maximized ? 'Restore' : 'Maximize'"
              @click="toggleMax"
            />
            <ZenIconButton icon="mdi mdi-close" title="Close (Esc)" @click="close" />
          </span>
        </header>
        <div class="zw-body"><slot /></div>
        <footer v-if="$slots.footer" class="zw-foot"><slot name="footer" /></footer>
        <div v-if="!maximized" class="zw-resize" title="Resize" @pointerdown="startResize" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* modeless by default: the full-screen root lets pointer events through; only the window
   itself is interactive. With a backdrop it becomes modal (root captures + dims). */
.zw-root {
  position: fixed;
  inset: 0;
  z-index: 100001;
  pointer-events: none;
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zw-root.zw-backdrop {
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(2px);
  pointer-events: auto;
}
.zw {
  position: fixed;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--zen-text, #e5e5ea);
  background: var(--zen-glass, color-mix(in srgb, var(--zen-bg, #1a1a1f) 90%, transparent));
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 12px);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
}
.zw-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 12px;
  cursor: grab;
  background: color-mix(in srgb, var(--zen-surface, #202026) 82%, transparent);
  border-bottom: 1px solid var(--zen-border, #34343c);
  user-select: none;
}
.zw-bar:active {
  cursor: grabbing;
}
.zw-icon {
  font-size: 16px;
  color: var(--zen-accent, #6366f1);
}
.zw-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zw-grow {
  flex: 1;
}
.zw-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.zw-no-drag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: default;
}
.zw-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.zw-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--zen-surface, #202026) 82%, transparent);
  border-top: 1px solid var(--zen-border, #34343c);
}
.zw-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 2;
}
.zw-resize::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--zen-muted, #9aa0aa);
  border-bottom: 2px solid var(--zen-muted, #9aa0aa);
  opacity: 0.55;
}
</style>
