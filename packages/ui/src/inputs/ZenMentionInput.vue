<template>
  <div
    ref="box"
    class="zmi"
    :class="{ focused, sized: height !== null }"
    :style="height !== null ? { height: `${height}px`, flex: 'none' } : undefined"
  >
    <div
      ref="mirror"
      class="zmi-mirror"
      aria-hidden="true"
      :style="gutter ? { paddingRight: `calc(10px + ${gutter}px)` } : undefined"
    >
      <template v-for="(part, i) in parts" :key="i">
        <mark v-if="part.mention" :class="part.known ? 'known' : 'unknown'">{{ part.text }}</mark>
        <template v-else>{{ part.text }}</template>
      </template>
      <span>&#8203;</span>
    </div>
    <textarea
      ref="area"
      class="zmi-area"
      :value="modelValue"
      :placeholder="placeholder"
      spellcheck="false"
      @input="onInput"
      @keydown="onKey"
      @click="followCaret"
      @keyup="onKeyUp"
      @scroll="syncScroll"
      @mousemove="onHover"
      @mouseleave="peek = null"
      @focus="focused = true"
      @blur="onBlur"
    />

    <span
      v-if="resizable"
      class="zmi-grip"
      title="Drag to resize — double-click to fit the text again"
      @pointerdown.stop.prevent="startResize"
      @dblclick.stop="height = null"
    />

    <Teleport to="body">
      <div
        v-if="peek && !open"
        data-zen-layer
        class="zmi-peek"
        :style="{ left: `${peek.x}px`, top: `${peek.y}px`, zIndex: peekZ }"
      >
        <slot name="preview" :item="peek.item">
          <img v-if="peek.item.thumb" :src="peek.item.thumb" alt="" />
          <i v-else :class="iconClass(peek.item.icon, 'mdi-at')" />
        </slot>
        <span class="zmi-text">
          <b>@{{ peek.item.key }}</b>
          <small v-if="peek.item.detail">{{ peek.item.detail }}</small>
        </span>
      </div>
      <div
        v-if="open && matches.length"
        data-zen-layer
        class="zmi-pop zen-scroll"
        :style="{ left: `${popPos.x}px`, top: `${popPos.y}px`, zIndex: popZ }"
        @pointerdown.prevent
      >
        <button
          v-for="(item, i) in matches"
          :key="item.key"
          type="button"
          class="zmi-item"
          :class="{ on: i === active }"
          @mouseenter="active = i"
          @click="insert(item)"
        >
          <span class="zmi-thumb">
            <slot name="thumb" :item="item">
              <img v-if="item.thumb" :src="item.thumb" alt="" />
              <i v-else :class="iconClass(item.icon, 'mdi-at')" />
            </slot>
          </span>
          <span class="zmi-text">
            <b>@{{ item.key }}</b>
            <small v-if="item.detail">{{ item.detail }}</small>
          </span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// ZenMentionInput — a textarea that knows about @mentions: known ones are highlighted as you type,
// unknown ones are flagged, and typing @ opens a filtered list (with thumbnails) at the caret.
// Arrow keys move, Enter or Tab inserts, Escape closes. The text stays plain — `@name` — so the
// consumer decides what a mention means.
import '../lib/scrollbar.css'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { iconClass } from '../lib/icon'
import { openLayer, zAbove, Z, type Layer } from '../overlays/layers'

export interface MentionItem {
  key: string
  detail?: string
  thumb?: string
  icon?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    items: MentionItem[]
    placeholder?: string
    /** A grip in the corner drags the box taller or shorter; past its height the text scrolls. */
    resizable?: boolean
  }>(),
  {
    placeholder: '',
    resizable: false,
  },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const area = ref<HTMLTextAreaElement | null>(null)
const mirror = ref<HTMLElement | null>(null)
const focused = ref(false)
const open = ref(false)
const query = ref('')
const active = ref(0)
const popPos = reactive({ x: 0, y: 0 })

const known = computed(() => new Set(props.items.map((i) => i.key.toLowerCase())))
const parts = computed(() =>
  props.modelValue.split(/(@[\w-]+)/).map((text) => ({
    text,
    mention: /^@[\w-]+$/.test(text),
    known: known.value.has(text.slice(1).toLowerCase()),
  })),
)

const matches = computed(() => {
  const q = query.value.toLowerCase()
  const scored = props.items
    .map((item) => {
      const k = item.key.toLowerCase()
      const score = k.startsWith(q)
        ? 0
        : k.includes(q)
          ? 1
          : (item.detail ?? '').toLowerCase().includes(q)
            ? 2
            : -1
      return { item, score }
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score)
  return scored.map((x) => x.item).slice(0, 8)
})

/** The @word being typed right before the caret, if any. */
function currentToken(): { start: number; text: string } | null {
  const el = area.value
  if (!el || el.selectionStart !== el.selectionEnd) return null
  const before = el.value.slice(0, el.selectionStart)
  const m = /(^|[^\w@])@([\w-]*)$/.exec(before)
  return m ? { start: el.selectionStart - m[2]!.length - 1, text: m[2]! } : null
}

/** The list only opens while typing a mention; moving the caret (a click, an arrow) only keeps it
 *  up to date, or closes it once the caret leaves the mention. */
function followCaret() {
  if (open.value) updateQuery()
}
function updateQuery() {
  const token = currentToken()
  if (!token) {
    open.value = false
    return
  }
  query.value = token.text
  active.value = 0
  open.value = true
  void nextTick(placePopup)
}

// Find the caret's screen position by measuring a marker in the mirror at the token's start.
function placePopup() {
  const el = area.value
  const mir = mirror.value
  const token = currentToken()
  if (!el || !mir || !token) return
  const probe = document.createElement('div')
  probe.className = 'zmi-mirror zmi-probe'
  probe.style.cssText = getComputedStyle(mir).cssText
  probe.style.visibility = 'hidden'
  probe.style.position = 'absolute'
  probe.textContent = el.value.slice(0, token.start)
  const mark = document.createElement('span')
  mark.textContent = '@'
  probe.appendChild(mark)
  mir.parentElement!.appendChild(probe)
  const rect = mark.getBoundingClientRect()
  probe.remove()
  popPos.x = Math.min(rect.left, window.innerWidth - 260)
  popPos.y = Math.min(rect.bottom - el.scrollTop + 4, window.innerHeight - 220)
}

function insert(item: MentionItem) {
  const el = area.value
  const token = currentToken()
  if (!el || !token) return
  const value = el.value
  const after = value.slice(el.selectionStart)
  const text = `@${item.key}${after.startsWith(' ') ? '' : ' '}`
  const next = value.slice(0, token.start) + text + after
  emit('update:modelValue', next)
  open.value = false
  void nextTick(() => {
    const pos = token.start + text.length
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
  void nextTick(updateQuery)
}
function onKey(e: KeyboardEvent) {
  if (!open.value || !matches.value.length) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = matches.value.length
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    insert(matches.value[active.value]!)
  } else if (e.key === 'Escape') {
    if (!layer?.escape(e)) return
    e.preventDefault()
    e.stopPropagation()
    open.value = false
  }
}
function onKeyUp(e: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) followCaret()
}
function onBlur() {
  focused.value = false
  open.value = false
}
/** Hovering a known mention shows what it refers to. The mirror sits under the textarea, so the
 *  pointer is tested against its marks' boxes rather than through events. */
const peek = ref<{ item: MentionItem; x: number; y: number } | null>(null)
function onHover(e: MouseEvent) {
  const marks = mirror.value?.querySelectorAll('mark.known') ?? []
  for (const mark of marks) {
    for (const r of mark.getClientRects()) {
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        continue
      const key = mark.textContent!.slice(1).toLowerCase()
      const item = props.items.find((i) => i.key.toLowerCase() === key)
      if (!item) continue
      if (peek.value?.item !== item)
        peek.value = {
          item,
          x: Math.min(r.left, window.innerWidth - 230),
          y: Math.min(r.bottom + 6, window.innerHeight - 240),
        }
      return
    }
  }
  peek.value = null
}
function syncScroll() {
  if (mirror.value && area.value) mirror.value.scrollTop = area.value.scrollTop
}

/** The width of the textarea's scrollbar. While it shows, the text wraps that much narrower, so
 *  the mirror is padded to match or its highlights drift off the words. The textarea's content box
 *  shrinks when the scrollbar appears, which is what the observer sees. */
const gutter = ref(0)
const measureGutter = () => {
  const el = area.value
  if (!el) return
  const style = getComputedStyle(el)
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
  gutter.value = Math.max(0, el.offsetWidth - el.clientWidth - borders)
  syncScroll()
}
const gutterObserver = new ResizeObserver(measureGutter)
onMounted(() => area.value && gutterObserver.observe(area.value))
onBeforeUnmount(() => gutterObserver.disconnect())

// The list joins the layer stack while it shows, so Escape closes it and not an enclosing modal
// or window; both popups render above whatever layer the input itself sits in.
let layer: Layer | null = null
const popZ = ref<number>(Z.popover)
const peekZ = ref<number>(Z.popover)
watch(
  () => open.value && matches.value.length > 0,
  (shown) => {
    if (shown && !layer) {
      layer = openLayer(Z.popover)
      popZ.value = layer.z
    } else if (!shown) {
      layer?.release()
      layer = null
    }
  },
)
watch(peek, (p) => {
  if (p) peekZ.value = zAbove(Z.popover)
})
onBeforeUnmount(() => layer?.release())

// The peek and the list are fixed to the screen; when anything around the input scrolls they
// would be left behind, so they close instead.
function onOuterScroll(e: Event) {
  if (e.target === area.value) return
  peek.value = null
  open.value = false
}
watch(
  () => !!peek.value || open.value,
  (shown) => {
    if (shown) window.addEventListener('scroll', onOuterScroll, { capture: true, passive: true })
    else window.removeEventListener('scroll', onOuterScroll, { capture: true })
  },
)
onBeforeUnmount(() => window.removeEventListener('scroll', onOuterScroll, { capture: true }))

// --- resizing: a grip in the corner sets the box's height; null fits it to the text --------------
const box = ref<HTMLElement | null>(null)
const height = ref<number | null>(null)
function startResize(e: PointerEvent) {
  const el = box.value
  if (!el || e.button !== 0) return
  const grip = e.currentTarget as HTMLElement
  grip.setPointerCapture(e.pointerId)
  // In the box's own pixels: it may be drawn scaled (a node on a zoomed canvas).
  const scale = el.getBoundingClientRect().height / Math.max(1, el.offsetHeight)
  const from = el.offsetHeight
  const sy = e.clientY
  const move = (m: PointerEvent) => {
    height.value = Math.max(48, Math.round(from + (m.clientY - sy) / scale))
  }
  const up = () => {
    grip.removeEventListener('pointermove', move)
    grip.removeEventListener('pointerup', up)
  }
  grip.addEventListener('pointermove', move)
  grip.addEventListener('pointerup', up)
}

defineExpose({ focus: () => area.value?.focus() })
</script>

<style scoped>
.zmi {
  position: relative;
  display: grid;
  min-height: 0;
  border: 1px solid var(--zen-control-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-field-bg, var(--zen-input, #1b1b20));
  transition: border-color 0.12s ease;
}
.zmi.focused {
  border-color: var(--zen-accent, #6366f1);
}
/* The mirror and the textarea share every metric, stacked in one grid cell. The textarea draws the
   text itself, so selection and caret always sit on the letters you see; the mirror under it only
   paints the mentions' highlights. Unresized, the box grows with its text, so nothing scrolls inside
   it and the highlights can't fall behind. */
.zmi-mirror,
.zmi-area {
  grid-area: 1 / 1;
  box-sizing: border-box;
  margin: 0;
  padding: 8px 10px;
  border: 0;
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  letter-spacing: normal;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: normal;
}
.zmi-mirror {
  overflow: hidden;
  color: transparent;
  pointer-events: none;
}
.zmi-mirror mark {
  border-radius: 3px;
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 28%, transparent);
  color: transparent;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--zen-accent, #6366f1) 45%, transparent);
}
.zmi-mirror mark.unknown {
  background: color-mix(in srgb, var(--zen-danger, #dc2626) 22%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--zen-danger, #dc2626) 55%, transparent);
  text-decoration: wavy underline var(--zen-danger, #dc2626);
}
.zmi-area {
  height: 100%;
  min-height: 100%;
  resize: none;
  outline: none;
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  caret-color: var(--zen-text, #e5e5ea);
}
/* Sized by its grip: the box keeps that height and its one grid row with it, so the textarea
   scrolls (the mirror following) instead of the box growing. */
.zmi.sized {
  grid-template-rows: 100%;
  overflow: hidden;
}
.zmi-grip {
  position: absolute;
  right: 1px;
  bottom: 1px;
  z-index: 1;
  width: 12px;
  height: 12px;
  cursor: ns-resize;
  touch-action: none;
  background:
    linear-gradient(
      135deg,
      transparent 55%,
      var(--zen-muted, #9aa0aa) 55%,
      var(--zen-muted, #9aa0aa) 62%,
      transparent 62%
    ),
    linear-gradient(
      135deg,
      transparent 75%,
      var(--zen-muted, #9aa0aa) 75%,
      var(--zen-muted, #9aa0aa) 82%,
      transparent 82%
    );
  opacity: 0.6;
}
.zmi-grip:hover {
  opacity: 1;
}
.zmi-area::placeholder {
  color: var(--zen-muted, #9aa0aa);
  opacity: 0.7;
}
.zmi-peek {
  position: fixed;
  z-index: 100000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 220px;
  padding: 6px;
  border: 1px solid var(--zen-surface-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-surface, #202026);
  box-shadow: 0 10px 30px rgb(0 0 0 / 45%);
  pointer-events: none;
}
.zmi-peek > img,
.zmi-peek > :deep(img),
.zmi-peek > :deep(video) {
  display: block;
  width: 100%;
  max-height: 180px;
  border-radius: calc(var(--zen-radius, 7px) - 2px);
  background: #0b0b0e;
  object-fit: contain;
}
.zmi-peek > .mdi {
  display: grid;
  place-items: center;
  height: 90px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 32px;
}
.zmi-pop {
  position: fixed;
  z-index: 100000;
  width: 250px;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--zen-surface-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-surface, #202026);
  box-shadow: 0 10px 30px rgb(0 0 0 / 45%);
}
.zmi-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.zmi-item.on {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 25%, transparent);
}
.zmi-thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  overflow: hidden;
  border-radius: 5px;
  background: #0b0b0e;
  color: var(--zen-muted, #9aa0aa);
}
.zmi-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.zmi-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.zmi-text b {
  color: #9db7ff;
  font-size: 12px;
}
.zmi-text small {
  overflow: hidden;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
