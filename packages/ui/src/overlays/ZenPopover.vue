<script setup lang="ts">
// ZenPopover — anchored, body-teleported floating panel for menus / dropdowns / flyouts /
// context menus. Centralizes what every ZenKit menu kept re-implementing: teleport (so it
// escapes a panel's overflow:hidden), viewport-aware placement with auto-flip, click-away +
// Escape dismiss, and a token-styled container. Drive it with the #trigger slot (a self-
// managing button) OR with v-model:open + :anchor (an element, a DOMRect, or an {x,y} point —
// e.g. a right-click). The default slot is the content and receives { close }.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

type Placement =
  'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start'
type Point = { x: number; y: number }
type Anchor = HTMLElement | DOMRect | Point | null | undefined

const props = withDefaults(
  defineProps<{
    open?: boolean
    anchor?: Anchor
    placement?: Placement
    offset?: number
    matchWidth?: boolean
  }>(),
  { placement: 'bottom-start', offset: 6, matchWidth: false },
)
const emit = defineEmits<{ 'update:open': [boolean] }>()

const uncontrolled = ref(false)
const isOpen = computed({
  get: () => (props.open !== undefined ? props.open : uncontrolled.value),
  set: (v) => {
    if (props.open !== undefined) emit('update:open', v)
    else uncontrolled.value = v
  },
})

const anchorEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const ready = ref(false) // hidden until placed, so it never flashes at 0,0

function rectOf(): DOMRect | null {
  const a = props.anchor
  if (a) {
    if (a instanceof HTMLElement) return a.getBoundingClientRect()
    if ('width' in a) return a
    return new DOMRect(a.x, a.y, 0, 0)
  }
  // trigger mode: the anchor wrapper is inline-flex (a real box around the trigger), so its
  // own rect is the trigger's — no fragile firstElementChild / zero-box display:contents.
  return anchorEl.value ? anchorEl.value.getBoundingClientRect() : null
}

function place() {
  const r = rectOf()
  const panel = panelEl.value
  if (!r || !panel) return
  const off = props.offset
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pw = panel.offsetWidth
  const ph = panel.offsetHeight
  const [p0, align] = props.placement.split('-')
  let main = p0
  // flip to the opposite side when there isn't room and the other side has it
  if (main === 'bottom' && r.bottom + off + ph > vh && r.top - off - ph >= 0) main = 'top'
  else if (main === 'top' && r.top - off - ph < 0 && r.bottom + off + ph <= vh) main = 'bottom'
  else if (main === 'right' && r.right + off + pw > vw && r.left - off - pw >= 0) main = 'left'
  else if (main === 'left' && r.left - off - pw < 0 && r.right + off + pw <= vw) main = 'right'
  const s: Record<string, string> = {}
  if (main === 'bottom') s.top = r.bottom + off + 'px'
  else if (main === 'top') s.bottom = vh - r.top + off + 'px'
  else if (main === 'right') s.left = r.right + off + 'px'
  else s.right = vw - r.left + off + 'px'
  if (main === 'bottom' || main === 'top') {
    if (align === 'end') s.right = Math.max(4, vw - r.right) + 'px'
    else s.left = Math.max(4, Math.min(r.left, vw - pw - 4)) + 'px'
  } else {
    if (align === 'end') s.bottom = Math.max(4, vh - r.bottom) + 'px'
    else s.top = Math.max(4, Math.min(r.top, vh - ph - 4)) + 'px'
  }
  if (props.matchWidth) s.minWidth = r.width + 'px'
  panelStyle.value = s
  ready.value = true
}

// Named `show`, not `open`, because there is already an `open` PROP. In <script setup> the
// template resolves setup bindings before props, so a local `open()` silently shadowed the
// prop. Both public names are unchanged: the exposed method and the slot prop are still `open`.
function show() {
  isOpen.value = true
}
function close() {
  isOpen.value = false
}
function toggle() {
  if (isOpen.value) close()
  else show()
}

function onDoc(e: PointerEvent) {
  const t = e.target as Node
  if (panelEl.value?.contains(t) || anchorEl.value?.contains(t)) return
  close()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
function onReflow() {
  if (isOpen.value) place()
}

function teardown() {
  window.removeEventListener('pointerdown', onDoc, true)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', onReflow)
  window.removeEventListener('scroll', onReflow, true)
}
watch(isOpen, (v) => {
  if (!v) {
    teardown()
    return
  }
  ready.value = false
  nextTick(() => {
    place()
    // defer the dismiss listeners a tick so the opening click doesn't immediately close it
    setTimeout(() => {
      window.addEventListener('pointerdown', onDoc, true)
      window.addEventListener('keydown', onKey, true)
    }, 0)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
  })
})
onBeforeUnmount(teardown)
defineExpose({ open: show, close, toggle })
</script>

<template>
  <span v-if="$slots.trigger" ref="anchorEl" class="zen-pop-anchor">
    <slot name="trigger" :toggle="toggle" :open="show" :close="close" :active="isOpen" />
  </span>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="panelEl"
      class="zen-pop"
      :style="[panelStyle, { visibility: ready ? 'visible' : 'hidden' }]"
      role="menu"
    >
      <slot :close="close" />
    </div>
  </Teleport>
</template>

<style scoped>
.zen-pop-anchor {
  display: inline-flex;
}
.zen-pop {
  position: fixed;
  z-index: 100000;
  min-width: 160px;
  max-width: min(360px, 92vw);
  box-sizing: border-box;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--zen-surface, #202026);
  border: 1px solid var(--zen-border, #3a3a44);
  border-radius: var(--zen-radius, 8px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  font-family: var(--p-font-family, system-ui, sans-serif);
  color: var(--zen-text, #e5e5ea);
}
</style>
