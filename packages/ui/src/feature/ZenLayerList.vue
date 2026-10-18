<script setup lang="ts">
// ZenLayerList — a stack of layers: pick one, hide it, lock it, drag it up or down.
//
// The host owns the order and shows it top-first (the way every layer panel reads); a drag only
// REPORTS where a row should go (`reorder`), so the host can map that back onto whatever order it
// stores. Pinned rows — a background that is always at the bottom — never move and can't be
// dropped past.
//
// The drag is pointer-driven and measured in client space: a node body sits inside a scaled
// canvas, and comparing the pointer against the rows' client rects is correct at any zoom. The
// grabbed row itself is translated, by the client delta divided by that scale, so it stays exactly
// under the pointer.
import { computed, ref } from 'vue'

import { insertionIndex, landingTop, rowStride, shiftStyle, sortShift } from '../lib/sortable'

export interface LayerItem {
  id: string
  label: string
  /** Swatch colour. */
  color?: string
  /** A second, dimmer line. */
  sub?: string
  /** Small image at the start of the row. */
  thumb?: string
  hidden?: boolean
  locked?: boolean
  /** Stays where it is: no grip, and nothing can be dropped past it. */
  pinned?: boolean
}

const props = withDefaults(
  defineProps<{
    items: LayerItem[]
    /** Offer the lock toggle. */
    lockable?: boolean
  }>(),
  { lockable: true },
)
const selected = defineModel<string[]>('selected', { default: () => [] })
const emit = defineEmits<{
  /** Move row `id` to display position `index` (0 = top). */
  reorder: [id: string, index: number]
  'toggle-hidden': [id: string]
  'toggle-locked': [id: string]
}>()

const list = ref<HTMLElement | null>(null)
const selectedSet = computed(() => new Set(selected.value))

function pick(item: LayerItem, e: MouseEvent) {
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    selected.value = selectedSet.value.has(item.id)
      ? selected.value.filter((s) => s !== item.id)
      : [...selected.value, item.id]
  } else {
    selected.value = [item.id]
  }
}

// --- drag to reorder ------------------------------------------------------------------------

const dragId = ref<string | null>(null)
const dropIndex = ref(-1)
const offset = ref(0)
const stride = ref(0)
let mids: number[] = []
let tops: number[] = []
let heights: number[] = []
// On the drop the host reorders with transitions off — the rows that moved aside are already in
// place — and only the dropped row glides the little way left to its slot.
const settling = ref(false)
const settle = ref<{ id: string; y: number } | null>(null)
let startY = 0
let scale = 1
let lo = 0
let hi = 0

function onGrip(e: PointerEvent, item: LayerItem, index: number) {
  if (e.button !== 0 || item.pinned || !list.value) return
  const rows = [...list.value.querySelectorAll<HTMLElement>('[data-layer-index]')]
  const row = rows[index]
  if (!row) return
  scale = row.getBoundingClientRect().height / (row.offsetHeight || 1) || 1
  mids = rows.map((el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  })
  tops = rows.map((el) => el.offsetTop)
  heights = rows.map((el) => el.offsetHeight)
  stride.value = rowStride(tops, heights, index)
  // The reachable range: between the nearest pinned rows on either side of this one.
  lo = 0
  hi = props.items.length - 1
  for (let i = index - 1; i >= 0; i--)
    if (props.items[i]?.pinned) {
      lo = i + 1
      break
    }
  for (let i = index + 1; i < props.items.length; i++)
    if (props.items[i]?.pinned) {
      hi = i - 1
      break
    }
  startY = e.clientY
  dragId.value = item.id
  dropIndex.value = index
  offset.value = 0
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}

function onGripMove(e: PointerEvent, index: number) {
  if (dragId.value === null) return
  offset.value = (e.clientY - startY) / scale
  const center = (mids[index] ?? e.clientY) + (e.clientY - startY)
  dropIndex.value = insertionIndex(mids, index, center, lo, hi)
}

function onGripUp() {
  const id = dragId.value
  const to = dropIndex.value
  const moved = offset.value
  dragId.value = null
  dropIndex.value = -1
  offset.value = 0
  if (id === null) return
  const from = props.items.findIndex((i) => i.id === id)
  if (from < 0 || to < 0) return
  settling.value = true
  settle.value = { id, y: (tops[from] ?? 0) + moved - landingTop(tops, heights, from, to) }
  if (to !== from) emit('reorder', id, to)
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      settling.value = false
      settle.value = null
    }),
  )
}

/** Rows between the grab and the landing slot move aside, so the drop is shown before it lands. */
function aside(index: number) {
  if (dragId.value === null) return undefined
  const from = props.items.findIndex((i) => i.id === dragId.value)
  return shiftStyle(sortShift(index, from, dropIndex.value), stride.value)
}
</script>

<template>
  <div ref="list" class="zll" :class="{ settling }" role="listbox" aria-multiselectable="true">
    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="zll-row"
      role="option"
      :aria-selected="selectedSet.has(item.id)"
      :class="{
        sel: selectedSet.has(item.id),
        hidden: item.hidden,
        pinned: item.pinned,
        dragging: dragId === item.id,
      }"
      :style="
        dragId === item.id
          ? { transform: `translateY(${offset}px)` }
          : settle?.id === item.id
            ? { transform: `translateY(${settle.y}px)` }
            : aside(index)
      "
      :data-layer-index="index"
      @click="pick(item, $event)"
    >
      <span
        v-if="!item.pinned"
        class="zll-grip"
        data-zen-drag
        title="Drag to reorder"
        @pointerdown.stop="onGrip($event, item, index)"
        @pointermove="onGripMove($event, index)"
        @pointerup="onGripUp"
        @pointercancel="onGripUp"
        @lostpointercapture="onGripUp"
        @click.stop
      >
        <i class="mdi mdi-drag-vertical" />
      </span>
      <span v-else class="zll-grip pin"><i class="mdi mdi-pin-outline" /></span>

      <span class="zll-swatch" :style="{ background: item.color ?? 'var(--zen-muted, #9aa0aa)' }">
        <img v-if="item.thumb" :src="item.thumb" alt="" draggable="false" />
      </span>
      <span class="zll-text">
        <span class="zll-label">{{ item.label }}</span>
        <span v-if="item.sub" class="zll-sub">{{ item.sub }}</span>
      </span>
      <slot name="actions" :item="item" />
      <button
        v-if="lockable && !item.pinned"
        type="button"
        class="zll-btn"
        :class="{ on: item.locked }"
        :title="item.locked ? 'Unlock' : 'Lock'"
        @click.stop="emit('toggle-locked', item.id)"
      >
        <i class="mdi" :class="item.locked ? 'mdi-lock' : 'mdi-lock-open-variant-outline'" />
      </button>
      <button
        type="button"
        class="zll-btn"
        :class="{ on: item.hidden }"
        :title="item.hidden ? 'Show' : 'Hide'"
        @click.stop="emit('toggle-hidden', item.id)"
      >
        <i class="mdi" :class="item.hidden ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" />
      </button>
    </div>
    <slot v-if="!items.length" name="empty" />
  </div>
</template>

<style scoped>
.zll {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.zll-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 2px 4px;
  border-radius: var(--zen-radius, 7px);
  border: 1px solid transparent;
  color: var(--zen-text, #e5e5ea);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    background 0.12s ease;
}
.zll-row:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 5%, transparent);
}
.zll-row.sel {
  border-color: color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 14%, transparent);
}
.zll-row.hidden .zll-text,
.zll-row.hidden .zll-swatch {
  opacity: 0.45;
}
.zll.settling .zll-row {
  transition: background 0.12s ease;
}
.zll-row.dragging {
  z-index: 1;
  transition: none;
  background: var(--zen-surface-2, #26262d);
  box-shadow: 0 6px 18px rgb(0 0 0 / 35%);
}
.zll-grip {
  display: grid;
  place-items: center;
  width: 14px;
  color: var(--zen-muted, #9aa0aa);
  cursor: grab;
  touch-action: none;
}
.zll-grip.pin {
  cursor: default;
  opacity: 0.6;
}
.zll-swatch {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 25%);
}
.zll-swatch img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.zll-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.zll-label {
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zll-sub {
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zll-btn {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  opacity: 0.55;
}
.zll-row:hover .zll-btn,
.zll-btn.on {
  opacity: 1;
}
.zll-btn:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 8%, transparent);
  color: var(--zen-text, #e5e5ea);
}
</style>
