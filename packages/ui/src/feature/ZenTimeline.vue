<template>
  <div class="ztl" :style="{ '--ztl-head': `${headWidth}px` }">
    <div ref="headsEl" class="ztl-heads" @wheel="onHeadsWheel">
      <div class="ztl-corner">
        <span class="ztl-time">{{ formatTime(playhead) }}</span>
      </div>
      <div
        v-for="t in tracks"
        :key="t.id"
        class="ztl-head"
        :class="{
          movable: t.movable,
          lifted: headDrag?.id === t.id,
          'has-actions': !!t.actions?.length,
        }"
        :data-track="t.id"
        :title="t.movable ? `${t.title ?? t.label} — drag to reorder` : (t.title ?? t.label)"
        :style="{
          height: `${t.height ?? 30}px`,
          transform: headDrag?.id === t.id ? `translateY(${headDrag.dy}px)` : undefined,
          boxShadow: t.color ? `inset 3px 0 0 ${t.color}` : undefined,
        }"
        @pointerdown="t.movable && startHeadDrag($event, t)"
        @contextmenu.prevent.stop="emit('context', { trackId: t.id }, playhead, $event)"
      >
        <img v-if="t.thumb" class="ztl-head-thumb" :src="t.thumb" alt="" draggable="false" />
        <i v-else-if="t.icon" :class="iconClass(t.icon)" />
        <span class="ztl-head-label">{{ t.label }}</span>
        <span v-if="t.actions?.length" class="ztl-head-actions">
          <button
            v-for="a in t.actions"
            :key="a.id"
            type="button"
            class="ztl-head-action"
            :class="{ on: a.active }"
            :title="a.title"
            @pointerdown.stop
            @click.stop="emit('action', t.id, a.id)"
          >
            <i v-if="a.icon" :class="iconClass(a.icon)" />
            {{ a.label }}
          </button>
        </span>
      </div>
      <div
        v-if="headDrag && headDrag.lineY !== null"
        class="ztl-insert"
        :style="{ top: `${headDrag.lineY}px` }"
      />
    </div>

    <div ref="scroller" class="ztl-scroll" @wheel="onWheel" @scroll="onScroll">
      <div class="ztl-body" :style="{ width: `${contentWidth}px` }">
        <div
          v-if="range"
          class="ztl-range"
          :style="{ left: `${x(range.start)}px`, width: `${x(range.end) - x(range.start)}px` }"
        />
        <div class="ztl-ruler" @pointerdown="startScrub">
          <span
            v-for="t in ticks"
            :key="t.at"
            class="ztl-tick"
            :class="{ major: t.major }"
            :style="{ left: `${x(t.at)}px` }"
          >
            <b v-if="t.major">{{ tickLabel(t.at) }}</b>
          </span>
        </div>

        <div
          v-for="(t, ti) in tracks"
          :key="t.id"
          class="ztl-track"
          :class="{ dropping: dropTrack === t.id, zebra: ti % 2 === 0 }"
          :style="{ height: `${t.height ?? 30}px` }"
          @dblclick.self="emit('dblclick', t.id, timeAt($event.clientX))"
          @contextmenu.prevent.stop="
            emit('context', { trackId: t.id }, timeAt($event.clientX), $event)
          "
          @dragover="onDragOver($event, t.id)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, t.id)"
          @pointerdown.self="onTrackDown($event, t.id)"
        >
          <svg
            v-if="t.curve"
            class="ztl-curve"
            :width="contentWidth"
            :height="t.height ?? 30"
            :style="{ '--ztl-curve': t.curve.color ?? 'var(--ztl-accent)' }"
            @pointerdown="emit('select', `curve:${t.id}`, t.id, $event)"
            @dblclick.stop="addCurvePoint($event, t)"
            @contextmenu.prevent.stop="
              emit('context', { trackId: t.id }, timeAt($event.clientX), $event)
            "
          >
            <line
              v-for="(st, i) in t.curve.steps ?? []"
              :key="'s' + i"
              class="ztl-cstep"
              :x1="x(st.start) + 2"
              :x2="x(st.end) - 2"
              :y1="cy(t, st.v)"
              :y2="cy(t, st.v)"
            />
            <line
              v-if="t.curve.unit !== undefined"
              class="ztl-cunit"
              :x1="x(0)"
              :x2="x(duration)"
              :y1="cy(t, t.curve.unit)"
              :y2="cy(t, t.curve.unit)"
            />
            <polygon class="ztl-carea" :points="curveArea(t)" />
            <polyline class="ztl-cline" :points="curveLine(t)" />
            <text
              v-if="!t.curve.points.length"
              class="ztl-cval"
              :x="x(0) + 6"
              :y="cy(t, t.curve.flat ?? curveRange(t).max) - 4"
            >
              {{ (t.curve.flat ?? curveRange(t).max).toFixed(2) }}
            </text>
            <text
              v-for="(p, i) in t.curve.points"
              :key="'v' + i"
              class="ztl-cval"
              text-anchor="middle"
              :x="x(p.t)"
              :y="cy(t, p.v) > (t.height ?? 30) / 2 ? cy(t, p.v) - 8 : cy(t, p.v) + 15"
            >
              {{ p.v.toFixed(2) }}
            </text>
            <circle
              v-for="(p, i) in t.curve.points"
              :key="'p' + i"
              class="ztl-cpt"
              :cx="x(p.t)"
              :cy="cy(t, p.v)"
              r="5"
              @pointerdown.stop="startCurvePoint($event, t, i)"
              @dblclick.stop
              @contextmenu.prevent.stop="removeCurvePoint(t, i)"
            >
              <title>{{ p.v.toFixed(2) }} at {{ formatTime(p.t) }}</title>
            </circle>
          </svg>
          <svg
            v-if="t.levels"
            class="ztl-curve ztl-levels"
            :class="{ shaped: t.levels.mode === 'shape' }"
            :width="contentWidth"
            :height="t.height ?? 30"
            :style="{ '--ztl-curve': t.levels.color ?? 'var(--ztl-accent)' }"
            @pointerdown="emit('select', `curve:${t.id}`, t.id, $event)"
            @contextmenu.prevent.stop="
              emit('context', { trackId: t.id }, timeAt($event.clientX), $event)
            "
          >
            <line
              v-if="t.levels.unit !== undefined"
              class="ztl-cunit"
              :x1="x(0)"
              :x2="x(duration)"
              :y1="cy(t, t.levels.unit)"
              :y2="cy(t, t.levels.unit)"
            />
            <g
              v-for="seg in t.levels.segments"
              :key="seg.id"
              class="ztl-lseg"
              :class="{ inherited: t.levels.mode === 'shape' ? seg.shapeInherited : seg.inherited }"
              @dblclick.stop="t.levels.mode === 'shape' && addShapePoint($event, t, seg)"
            >
              <template v-if="t.levels.mode !== 'shape'">
                <rect
                  class="ztl-larea"
                  :x="x(seg.start) + 1"
                  :y="cy(t, seg.v)"
                  :width="Math.max(0, x(seg.end) - x(seg.start) - 2)"
                  :height="Math.max(0, (t.height ?? 30) - cy(t, seg.v))"
                />
                <line
                  class="ztl-lbar"
                  :x1="x(seg.start) + 1"
                  :x2="x(seg.end) - 1"
                  :y1="cy(t, seg.v)"
                  :y2="cy(t, seg.v)"
                />
                <line
                  class="ztl-lhit"
                  :x1="x(seg.start) + 1"
                  :x2="x(seg.end) - 1"
                  :y1="cy(t, seg.v)"
                  :y2="cy(t, seg.v)"
                  @pointerdown.stop="startLevel($event, t, seg.id)"
                  @dblclick.stop="emit('level', t.id, seg.id, null)"
                >
                  <title>{{ seg.title ?? seg.v.toFixed(2) }}</title>
                </line>
                <text
                  class="ztl-cval"
                  :x="x(seg.start) + 6"
                  :y="cy(t, seg.v) > (t.height ?? 30) / 2 ? cy(t, seg.v) - 5 : cy(t, seg.v) + 13"
                >
                  {{ seg.v.toFixed(2) }}
                </text>
              </template>
              <template v-else>
                <rect
                  class="ztl-lpad"
                  :x="x(seg.start)"
                  :y="0"
                  :width="Math.max(0, x(seg.end) - x(seg.start))"
                  :height="t.height ?? 30"
                />
                <polygon class="ztl-carea" :points="shapeArea(t, seg)" />
                <polyline class="ztl-cline" :points="shapeLine(t, seg)" />
                <circle
                  v-for="(p, i) in seg.shape ?? []"
                  :key="'p' + i"
                  class="ztl-cpt"
                  :cx="shapeX(seg, p.x)"
                  :cy="cy(t, p.y)"
                  r="4"
                  @pointerdown.stop="startShapePoint($event, t, seg, i)"
                  @dblclick.stop
                  @contextmenu.prevent.stop="removeShapePoint(t, seg, i)"
                >
                  <title>×{{ p.y.toFixed(2) }} at {{ Math.round(p.x * 100) }}%</title>
                </circle>
              </template>
            </g>
          </svg>
          <div
            v-for="item in t.items"
            :key="item.id"
            class="ztl-item"
            :class="[
              item.kind === 'marker' ? 'marker' : 'clip',
              {
                on: isSelected(item.id),
                muted: item.muted,
                thumbed: !!item.thumb,
                ghost: item.ghost,
                lifted: held?.id === item.id,
              },
            ]"
            :style="itemStyle(item)"
            :title="item.title ?? item.label"
            @pointerdown="startMove($event, t, item)"
            @contextmenu.prevent.stop="
              emit('context', { trackId: t.id, itemId: item.id }, timeAt($event.clientX), $event)
            "
            @dblclick.stop="emit('open', item.id, t.id)"
          >
            <img v-if="item.thumb" :src="item.thumb" alt="" draggable="false" />
            <i v-if="item.icon" class="mdi ztl-icon" :class="iconClass(item.icon)" />
            <span v-if="item.kind !== 'marker' && item.label" class="ztl-label">
              {{ item.label }}
            </span>
            <span
              v-if="item.progress != null"
              class="ztl-progress"
              :style="{ width: `${Math.min(Math.max(item.progress, 0), 1) * 100}%` }"
            />
            <span
              v-if="
                item.kind !== 'marker' &&
                (item.resize ?? 'end') !== false &&
                item.resize !== 'start'
              "
              class="ztl-grip end"
              @pointerdown.stop="startResize($event, t, item, 'end')"
            />
            <span
              v-if="item.kind !== 'marker' && (item.resize === 'start' || item.resize === 'both')"
              class="ztl-grip start"
              @pointerdown.stop="startResize($event, t, item, 'start')"
            />
          </div>
        </div>

        <div v-for="g in guides" :key="g" class="ztl-guide" :style="{ left: `${x(g)}px` }" />
        <div v-if="snapLine != null" class="ztl-snapline" :style="{ left: `${x(snapLine)}px` }" />
        <div class="ztl-playhead" :style="{ transform: `translateX(${x(playhead)}px)` }">
          <span />
        </div>
      </div>
    </div>
    <!-- Our own horizontal scrollbar, floating over the tracks: the browser's takes height when
         zooming makes the tracks overflow, and shoves the whole timeline up. -->
    <div
      v-if="overflowing"
      class="ztl-hbar"
      :style="{ left: `${headWidth}px` }"
      @pointerdown="startBar"
    >
      <div class="ztl-thumb" :style="thumbStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
// ZenTimeline — a small multi-track editor timeline. Tracks are rows of items on one clock:
// clips (start → end, resizable at either edge) and markers (a point, often a thumbnail). A ruler
// to click or drag-scrub the playhead, ctrl/⌘ + wheel to zoom, guides for boundaries that cross
// every track, and right-click / drop / double-click reported with the time under the pointer.
//
// Controlled: it emits what changed and the parent writes it back. `zoom` is pixels per second;
// 0 fits the whole duration to the width.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { iconClass } from '../lib/icon'

export interface TimelineItem {
  id: string
  /** Seconds. A marker sits at `start`; a clip runs `start` → `end`. */
  start: number
  end?: number
  kind?: 'clip' | 'marker'
  label?: string
  title?: string
  color?: string
  thumb?: string
  icon?: string
  muted?: boolean
  /** A placeholder (an empty slot to fill): drawn dashed, never dragged. */
  ghost?: boolean
  /** Which edges can be dragged. Default 'end' for clips. */
  resize?: 'start' | 'end' | 'both' | false
  /** Whether the item itself can be dragged along the track. Default: markers yes, clips no. */
  movable?: boolean
  /** 'drop': while dragged the item just follows the pointer, and `move` is emitted once, on
   *  release — for items whose new place rearranges others (live moves would reshuffle them under
   *  the pointer). Default 'live': `move` on every step. */
  commit?: 'live' | 'drop'
  /** 0–1: a progress fill along the clip's bottom edge (a render, an upload…). */
  progress?: number
  /** Items with the same group move together (a video and its sound): dragging one shows the others
   *  following, and they never snap to each other. */
  group?: string
}
export interface TimelineCurve {
  points: { t: number; v: number }[]
  min?: number
  max?: number
  flat?: number
  steps?: { start: number; end: number; v: number }[]
  color?: string
  /** A dashed guide at this value (e.g. 1 for "full strength"). */
  unit?: number
}
/** One value per segment of the film (e.g. per scene), drawn as flat bars you drag up or down. In
 *  `mode: 'shape'` each segment shows instead its `shape`, a curve across the segment (x 0–1),
 *  edited in place. `inherited` marks a value or shape the segment takes from elsewhere (dashed). */
export interface TimelineLevels {
  segments: {
    id: string
    start: number
    end: number
    v: number
    inherited?: boolean
    title?: string
    shape?: { x: number; y: number }[]
    shapeInherited?: boolean
  }[]
  mode?: 'levels' | 'shape'
  min?: number
  max?: number
  /** A dashed guide at this value. */
  unit?: number
  color?: string
  /** A shape's value while it has no points. */
  shapeFlat?: number
}
/** A small button on a track's header. */
export interface TimelineTrackAction {
  id: string
  icon?: string
  label?: string
  title?: string
  active?: boolean
}
export interface TimelineTrack {
  id: string
  label: string
  /** Full name, shown on hover when the label is cut short. */
  title?: string
  icon?: string
  /** A small picture in the track's header instead of the icon. */
  thumb?: string
  /** Its header can be dragged up or down among the other movable tracks (emits `reorder`). */
  movable?: boolean
  /** Marks the track's header with a stripe of this colour. */
  color?: string
  /** A value over time drawn in the track: points to drag, double-click to add, right-click to
   *  remove (emits `curve`). `steps` draws what is actually used under it — e.g. one value per
   *  scene — and `flat` is the line shown while there are no points. */
  curve?: TimelineCurve
  levels?: TimelineLevels
  actions?: TimelineTrackAction[]
  height?: number
  items: TimelineItem[]
}
export interface TimelineTarget {
  trackId: string
  itemId?: string
}

const props = withDefaults(
  defineProps<{
    duration: number
    tracks: TimelineTrack[]
    selected?: string | string[] | null
    snap?: number
    /** Lines through every track at these times (e.g. scene boundaries). */
    guides?: number[]
    /** A span shaded across every track and marked on the ruler — a loop, an in/out range. */
    range?: { start: number; end: number } | null
    headWidth?: number
    /** Magnetic snapping, in px: a dragged item's edges (or a trimmed edge, or a drop) catch on
     *  other items' edges, the playhead and `snapPoints` within this distance. `false` turns it off;
     *  Alt held while dragging skips it. Otherwise positions fall on the `snap` grid. */
    magnet?: number | false
    /** Extra times to snap to (markers, beats…). */
    snapPoints?: number[]
  }>(),
  {
    selected: null,
    snap: 0.05,
    guides: () => [],
    range: null,
    headWidth: 112,
    magnet: 6,
    snapPoints: () => [],
  },
)
const playhead = defineModel<number>('playhead', { default: 0 })
const zoom = defineModel<number>('zoom', { default: 0 })
const emit = defineEmits<{
  select: [itemId: string | null, trackId: string, event: PointerEvent]
  open: [itemId: string, trackId: string]
  move: [itemId: string, trackId: string, change: { start?: number; end?: number }]
  context: [target: TimelineTarget, time: number, event: MouseEvent]
  drop: [trackId: string, time: number, event: DragEvent]
  dblclick: [trackId: string, time: number]
  /** A movable track was dragged to sit before `beforeId` (null: after the last movable track). */
  reorder: [trackId: string, beforeId: string | null]
  /** A curve track's points changed (a drag, an add, a remove). */
  curve: [trackId: string, points: { t: number; v: number }[]]
  /** A levels segment dragged to `v`; null asks to reset it (double-click). */
  level: [trackId: string, segmentId: string, v: number | null]
  /** A levels segment's shape changed. */
  shape: [trackId: string, segmentId: string, points: { x: number; y: number }[]]
  /** One of a track header's `actions` was clicked. */
  action: [trackId: string, actionId: string]
}>()

// --- reordering tracks by their headers ---------------------------------------------------------
const headsEl = ref<HTMLElement | null>(null)
const headDrag = ref<{
  id: string
  lineY: number | null
  before: string | null
  dy: number
} | null>(null)
function startHeadDrag(e: PointerEvent, track: TimelineTrack) {
  if (e.button !== 0) return
  const el = e.currentTarget as HTMLElement
  const heads = headsEl.value
  if (!heads) return
  el.setPointerCapture(e.pointerId)
  // Work in the headers' own coordinates: the timeline may be drawn scaled (a node on a zoomed
  // canvas) and its tracks scrolled, and screen pixels are neither.
  const scale = () => heads.getBoundingClientRect().height / Math.max(1, heads.offsetHeight)
  const local = (clientY: number) =>
    (clientY - heads.getBoundingClientRect().top) / scale() + heads.scrollTop
  const startY = local(e.clientY)
  let moved = false
  const move = (m: PointerEvent) => {
    const y = local(m.clientY)
    if (!moved && Math.abs(y - startY) < 4) return
    moved = true
    // Near the top or bottom edge, scroll the tracks so a far target can be reached.
    const view = (m.clientY - heads.getBoundingClientRect().top) / scale()
    const edge = 22
    if (scroller.value && view < edge + 24) scroller.value.scrollTop -= 8
    else if (scroller.value && view > heads.clientHeight - edge) scroller.value.scrollTop += 8
    const rows = [...heads.querySelectorAll<HTMLElement>('.ztl-head.movable')]
    const next = rows.find(
      (h) => h.dataset.track !== track.id && y < h.offsetTop + h.offsetHeight / 2,
    )
    const lastRow = rows.filter((h) => h.dataset.track !== track.id).pop()
    const lineY = next ? next.offsetTop : lastRow ? lastRow.offsetTop + lastRow.offsetHeight : null
    headDrag.value = { id: track.id, lineY, before: next?.dataset.track ?? null, dy: y - startY }
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    const d = headDrag.value
    headDrag.value = null
    if (!moved || !d) return
    // Dropping where it already is changes nothing.
    const order = props.tracks.filter((t) => t.movable).map((t) => t.id)
    const at = order.indexOf(track.id)
    const stays = d.before === order[at + 1] || (d.before === null && at === order.length - 1)
    if (!stays) emit('reorder', track.id, d.before)
  }
  headDrag.value = { id: track.id, lineY: null, before: null, dy: 0 }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

const scroller = ref<HTMLElement | null>(null)
const viewWidth = ref(600)
const scrollX = ref(0)
const dropTrack = ref<string | null>(null)
/** An item being dragged with `commit: 'drop'`: where it is drawn until it is let go. */
/** An item being dragged (commit: 'drop'): where it would land, and the others moving with it. */
const held = ref<{ id: string; start: number; delta: number; with: Set<string> } | null>(null)
/** Where a drag is snapped to right now, drawn as a line. */
const snapLine = ref<number | null>(null)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!scroller.value || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(([e]) => (viewWidth.value = e?.contentRect.width ?? viewWidth.value))
  ro.observe(scroller.value)
})
onBeforeUnmount(() => ro?.disconnect())

const PAD = 14
const fit = computed(() => Math.max(4, (viewWidth.value - PAD * 2) / Math.max(props.duration, 0.1)))
const pps = computed(() => (zoom.value > 0 ? zoom.value : fit.value))
const contentWidth = computed(() => Math.max(viewWidth.value, props.duration * pps.value + PAD * 2))

function onScroll() {
  const el = scroller.value
  if (!el) return
  scrollX.value = el.scrollLeft
  if (headsEl.value) headsEl.value.scrollTop = el.scrollTop
}
/** The headers don't scroll on their own; the wheel over them scrolls the tracks. */
function onHeadsWheel(e: WheelEvent) {
  const el = scroller.value
  if (!el || e.ctrlKey || e.metaKey || e.altKey || el.scrollHeight <= el.clientHeight) return
  e.preventDefault()
  el.scrollTop += e.deltaY
}

// --- overlay scrollbar ----------------------------------------------------------------------------
const overflowing = computed(() => contentWidth.value > viewWidth.value + 1)
const thumbStyle = computed(() => {
  const ratio = viewWidth.value / contentWidth.value
  return {
    width: `${Math.max(24, ratio * viewWidth.value)}px`,
    left: `${(scrollX.value / contentWidth.value) * viewWidth.value}px`,
  }
})
/** Drag the thumb to scroll; press the track elsewhere to jump there and keep dragging. */
function startBar(e: PointerEvent) {
  const el = scroller.value
  if (!el || e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  const perPx = contentWidth.value / viewWidth.value / screenScale()
  const bar = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const thumb = (e.currentTarget as HTMLElement).firstElementChild!.getBoundingClientRect()
  if (e.clientX < thumb.left || e.clientX > thumb.right)
    el.scrollLeft = (e.clientX - bar.left - thumb.width / 2) * perPx
  const from = el.scrollLeft
  const sx = e.clientX
  // The bar holds the pointer capture, so its own events carry the drag — inside a node the
  // window never sees them.
  const target = e.currentTarget as HTMLElement
  const move = (m: PointerEvent) => (el.scrollLeft = from + (m.clientX - sx) * perPx)
  const up = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', up)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)
}
const x = (t: number) => PAD + t * pps.value
const snapTo = (t: number) => Math.round(t / props.snap) * props.snap

const allItems = () => props.tracks.flatMap((t) => t.items)
/** An item and everything that moves with it: its group, and the rest of the selection if it is
 *  selected. */
function companions(item: TimelineItem): Set<string> {
  const ids = new Set([item.id])
  const selected = isSelected(item.id)
  const groups = new Set<string>()
  for (const o of allItems())
    if (o.id === item.id || (selected && isSelected(o.id))) {
      ids.add(o.id)
      if (o.group) groups.add(o.group)
    }
  for (const o of allItems()) if (o.group && groups.has(o.group)) ids.add(o.id)
  return ids
}
/** The nearest snap target to any of `edges`, within the magnet's reach: how far to shift them,
 *  and where the line goes. Null when nothing is in reach (or snapping is off / Alt is held). */
function magnetize(edges: number[], skip: Set<string>, e?: { altKey: boolean }) {
  if (props.magnet === false || e?.altKey) return null
  const reach = props.magnet / pps.value
  const targets = [0, playhead.value, ...props.snapPoints]
  for (const o of allItems())
    if (!skip.has(o.id) && !o.ghost) targets.push(o.start, ...(o.end != null ? [o.end] : []))
  let best: { shift: number; at: number } | null = null
  for (const edge of edges)
    for (const at of targets) {
      const shift = at - edge
      if (Math.abs(shift) <= reach && (!best || Math.abs(shift) < Math.abs(best.shift)))
        best = { shift, at }
    }
  return best
}
/** `t` caught by the magnet (showing the line), else on the grid. */
function snapEdge(t: number, skip: Set<string>, e?: { altKey: boolean }): number {
  const m = magnetize([t], skip, e)
  snapLine.value = m?.at ?? null
  return m ? m.at : snapTo(t)
}

/** How much the timeline is scaled on screen — 1, unless it is drawn inside a node on a zoomed
 *  canvas. Pointer positions are screen pixels; everything here is laid out in CSS pixels. */
function screenScale(): number {
  const el = scroller.value
  if (!el || !el.offsetWidth) return 1
  return el.getBoundingClientRect().width / el.offsetWidth || 1
}
// --- curve tracks ---------------------------------------------------------------------------------
const CURVE_PAD = 4
function curveRange(t: TimelineTrack) {
  const src = t.curve ?? t.levels
  const min = src?.min ?? 0
  return { min, max: Math.max(min + 1e-6, src?.max ?? 1) }
}
function cy(t: TimelineTrack, v: number): number {
  const { min, max } = curveRange(t)
  const h = t.height ?? 30
  return (
    CURVE_PAD + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * (h - CURVE_PAD * 2)
  )
}
function valueAt(t: TimelineTrack, localY: number): number {
  const { min, max } = curveRange(t)
  const h = t.height ?? 30
  const f = 1 - (localY - CURVE_PAD) / (h - CURVE_PAD * 2)
  return Math.round(Math.min(max, Math.max(min, min + f * (max - min))) * 100) / 100
}
/** The line through the points, held flat out to both ends of the film. */
function curveLine(t: TimelineTrack): string {
  const pts = t.curve!.points
  if (!pts.length) {
    const y = cy(t, t.curve!.flat ?? curveRange(t).max)
    return `${x(0)},${y} ${x(props.duration)},${y}`
  }
  const ends = [{ t: 0, v: pts[0]!.v }, ...pts, { t: props.duration, v: pts[pts.length - 1]!.v }]
  return ends.map((p) => `${x(p.t)},${cy(t, p.v)}`).join(' ')
}
function curveArea(t: TimelineTrack): string {
  const bottom = t.height ?? 30
  return `${x(0)},${bottom} ${curveLine(t)} ${x(props.duration)},${bottom}`
}
function localY(svg: Element, clientY: number): number {
  return (clientY - svg.getBoundingClientRect().top) / screenScale()
}
function addCurvePoint(e: MouseEvent, t: TimelineTrack) {
  const svg = e.currentTarget as Element
  const point = { t: snapTo(timeAt(e.clientX)), v: valueAt(t, localY(svg, e.clientY)) }
  emit(
    'curve',
    t.id,
    [...t.curve!.points, point].sort((a, b) => a.t - b.t),
  )
}
function removeCurvePoint(t: TimelineTrack, i: number) {
  emit(
    'curve',
    t.id,
    t.curve!.points.filter((_, j) => j !== i),
  )
}
/** Drag a point: time along the track (kept between its neighbours), value up and down. */
function startCurvePoint(e: PointerEvent, t: TimelineTrack, i: number) {
  if (e.button !== 0) return
  const dot = e.currentTarget as SVGCircleElement
  const svg = dot.ownerSVGElement!
  dot.setPointerCapture(e.pointerId)
  emit('select', `curve:${t.id}`, t.id, e)
  const move = (m: PointerEvent) => {
    const pts = t.curve!.points.map((p) => ({ ...p }))
    const lo = pts[i - 1]?.t ?? 0
    const hi = pts[i + 1]?.t ?? props.duration
    pts[i] = {
      t: Math.min(hi, Math.max(lo, snapTo(timeAt(m.clientX)))),
      v: valueAt(t, localY(svg, m.clientY)),
    }
    emit('curve', t.id, pts)
  }
  const up = () => {
    dot.removeEventListener('pointermove', move)
    dot.removeEventListener('pointerup', up)
  }
  dot.addEventListener('pointermove', move)
  dot.addEventListener('pointerup', up)
}

// --- levels tracks --------------------------------------------------------------------------------
type Segment = TimelineLevels['segments'][number]
/** Drag a segment's bar up or down: steps of 0.05, or 0.01 with Shift. */
function startLevel(e: PointerEvent, t: TimelineTrack, id: string) {
  if (e.button !== 0) return
  const bar = e.currentTarget as SVGLineElement
  const svg = bar.ownerSVGElement!
  bar.setPointerCapture(e.pointerId)
  emit('select', `curve:${t.id}`, t.id, e)
  const move = (m: PointerEvent) => {
    const step = m.shiftKey ? 0.01 : 0.05
    const v = Math.round(valueAt(t, localY(svg, m.clientY)) / step) * step
    emit('level', t.id, id, Math.round(v * 100) / 100)
  }
  const up = () => {
    bar.removeEventListener('pointermove', move)
    bar.removeEventListener('pointerup', up)
  }
  bar.addEventListener('pointermove', move)
  bar.addEventListener('pointerup', up)
}
const SHAPE_INSET = 4
/** Where a shape's x (0–1) falls inside a segment. */
function shapeX(seg: Segment, sx: number): number {
  const a = x(seg.start) + SHAPE_INSET
  return a + sx * Math.max(0, x(seg.end) - SHAPE_INSET - a)
}
function shapeAt(seg: Segment, clientX: number, svg: Element): number {
  const local = (clientX - svg.getBoundingClientRect().left) / screenScale()
  const a = x(seg.start) + SHAPE_INSET
  const w = Math.max(1, x(seg.end) - SHAPE_INSET - a)
  return Math.round(Math.min(1, Math.max(0, (local - a) / w)) * 100) / 100
}
function shapePoints(t: TimelineTrack, seg: Segment): { x: number; y: number }[] {
  const pts = seg.shape ?? []
  const flat = t.levels!.shapeFlat ?? 1
  if (!pts.length)
    return [
      { x: 0, y: flat },
      { x: 1, y: flat },
    ]
  return [{ x: 0, y: pts[0]!.y }, ...pts, { x: 1, y: pts[pts.length - 1]!.y }]
}
function shapeLine(t: TimelineTrack, seg: Segment): string {
  return shapePoints(t, seg)
    .map((p) => `${shapeX(seg, p.x)},${cy(t, p.y)}`)
    .join(' ')
}
function shapeArea(t: TimelineTrack, seg: Segment): string {
  const bottom = t.height ?? 30
  return `${shapeX(seg, 0)},${bottom} ${shapeLine(t, seg)} ${shapeX(seg, 1)},${bottom}`
}
function addShapePoint(e: MouseEvent, t: TimelineTrack, seg: Segment) {
  const svg = (e.currentTarget as SVGElement).ownerSVGElement!
  if (t.levels?.mode !== 'shape') return
  const p = { x: shapeAt(seg, e.clientX, svg), y: valueAt(t, localY(svg, e.clientY)) }
  emit(
    'shape',
    t.id,
    seg.id,
    [...(seg.shape ?? []), p].sort((a, b) => a.x - b.x),
  )
}
function removeShapePoint(t: TimelineTrack, seg: Segment, i: number) {
  emit(
    'shape',
    t.id,
    seg.id,
    (seg.shape ?? []).filter((_, j) => j !== i),
  )
}
/** Drag one of a segment's shape points, along the segment and up or down. */
function startShapePoint(e: PointerEvent, t: TimelineTrack, seg: Segment, i: number) {
  if (e.button !== 0) return
  const dot = e.currentTarget as SVGCircleElement
  const svg = dot.ownerSVGElement!
  dot.setPointerCapture(e.pointerId)
  emit('select', `curve:${t.id}`, t.id, e)
  const move = (m: PointerEvent) => {
    const pts = (seg.shape ?? []).map((p) => ({ ...p }))
    const lo = pts[i - 1]?.x ?? 0
    const hi = pts[i + 1]?.x ?? 1
    pts[i] = {
      x: Math.min(hi, Math.max(lo, shapeAt(seg, m.clientX, svg))),
      y: valueAt(t, localY(svg, m.clientY)),
    }
    emit('shape', t.id, seg.id, pts)
  }
  const up = () => {
    dot.removeEventListener('pointermove', move)
    dot.removeEventListener('pointerup', up)
  }
  dot.addEventListener('pointermove', move)
  dot.addEventListener('pointerup', up)
}

function timeAt(clientX: number): number {
  const el = scroller.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const t = ((clientX - rect.left) / screenScale() + el.scrollLeft - PAD) / pps.value
  return Math.min(Math.max(t, 0), props.duration)
}

const isSelected = (id: string) =>
  Array.isArray(props.selected) ? props.selected.includes(id) : props.selected === id

function itemStyle(item: TimelineItem) {
  const left = x(held.value?.with.has(item.id) ? item.start + held.value.delta : item.start)
  if (item.kind === 'marker') return { left: `${left}px`, '--ztl-color': item.color }
  const width = Math.max(6, ((item.end ?? item.start) - item.start) * pps.value)
  return { left: `${left}px`, width: `${width}px`, '--ztl-color': item.color }
}

// Ticks: a step that keeps majors about 80px apart, with minor ticks between them.
const ticks = computed(() => {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  const major = steps.find((s) => s * pps.value >= 80) ?? 600
  const minor = major / (major >= 1 ? 4 : 5)
  const out: { at: number; major: boolean }[] = []
  for (let t = 0; t <= props.duration + 1e-6; t += minor) {
    const at = Math.round(t * 1000) / 1000
    out.push({ at, major: Math.abs(at / major - Math.round(at / major)) < 1e-6 })
  }
  return out
})
function tickLabel(t: number): string {
  if (t < 60) return Number.isInteger(t) ? `${t}s` : `${t.toFixed(1)}s`
  return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`
}
function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

// Drags take pointer capture so they keep tracking outside the strip and never become a node drag.
function drag(
  e: PointerEvent,
  move: (t: number, ev: PointerEvent) => void,
  end?: () => void,
): void {
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const onMove = (ev: PointerEvent) => move(timeAt(ev.clientX), ev)
  const stop = () => {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', stop)
    el.removeEventListener('pointercancel', stop)
    snapLine.value = null
    end?.()
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', stop)
  el.addEventListener('pointercancel', stop)
}

function startScrub(e: PointerEvent): void {
  if (e.button !== 0) return
  playhead.value = timeAt(e.clientX)
  drag(e, (t) => (playhead.value = t))
}

function onTrackDown(e: PointerEvent, trackId: string): void {
  if (e.button !== 0) return
  emit('select', null, trackId, e)
  startScrub(e)
}

function startMove(e: PointerEvent, track: TimelineTrack, item: TimelineItem): void {
  if (e.button !== 0) return
  emit('select', item.id, track.id, e)
  const movable = !item.ghost && (item.movable ?? item.kind === 'marker')
  if (!movable) return
  const offset = timeAt(e.clientX) - item.start
  const length = (item.end ?? item.start) - item.start
  const together = companions(item)
  const clamp = (t: number) => Math.min(Math.max(t, 0), props.duration - length)
  const place = (t: number, ev: PointerEvent) => {
    const start = clamp(t - offset)
    const m = magnetize(item.end == null ? [start] : [start, start + length], together, ev)
    snapLine.value = m?.at ?? null
    return m ? clamp(start + m.shift) : clamp(snapTo(start))
  }
  const change = (start: number) => (item.end == null ? { start } : { start, end: start + length })
  if (item.commit === 'drop') {
    let moved = false
    drag(
      e,
      (t, ev) => {
        moved = true
        const start = place(t, ev)
        held.value = { id: item.id, start, delta: start - item.start, with: together }
      },
      () => {
        const at = held.value?.start
        held.value = null
        if (moved && at !== undefined) emit('move', item.id, track.id, change(at))
      },
    )
    return
  }
  drag(e, (t, ev) => emit('move', item.id, track.id, change(place(t, ev))))
}

function startResize(
  e: PointerEvent,
  track: TimelineTrack,
  item: TimelineItem,
  edge: 'start' | 'end',
): void {
  if (e.button !== 0) return
  emit('select', item.id, track.id, e)
  const together = companions(item)
  drag(e, (t, ev) => {
    const at = snapEdge(t, together, ev)
    emit('move', item.id, track.id, edge === 'start' ? { start: at } : { end: at })
  })
}

/** Alt / Ctrl / ⌘ + wheel zooms about the pointer (inside ComfyUI only Alt arrives — Ctrl + wheel
 *  always goes to the canvas). A plain wheel pans along a zoomed-in timeline. */
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    const el = scroller.value
    if (!el) return
    const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)
    // Up and down scrolls the tracks when they overflow (the browser does that); otherwise, or with
    // Shift, the wheel pans along a zoomed-in timeline.
    if (!sideways && el.scrollHeight > el.clientHeight) return
    if (el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    return
  }
  e.preventDefault()
  e.stopPropagation()
  const el = scroller.value!
  const anchor = timeAt(e.clientX)
  const next = Math.min(Math.max(pps.value * (e.deltaY < 0 ? 1.15 : 1 / 1.15), fit.value), 2000)
  zoom.value = Math.abs(next - fit.value) < 0.5 ? 0 : next
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect()
    el.scrollLeft = PAD + anchor * pps.value - (e.clientX - rect.left) / screenScale()
  })
}

function onDragOver(e: DragEvent, trackId: string): void {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dropTrack.value = trackId
  snapEdge(timeAt(e.clientX), new Set(), e)
}
function onDragLeave(): void {
  dropTrack.value = null
  snapLine.value = null
}
function onDrop(e: DragEvent, trackId: string): void {
  dropTrack.value = null
  const at = snapEdge(timeAt(e.clientX), new Set(), e)
  snapLine.value = null
  emit('drop', trackId, at, e)
}

/** Keep the playhead in view (call while playing). */
function follow(): void {
  const el = scroller.value
  if (!el) return
  const px = x(playhead.value)
  if (px < el.scrollLeft + 20 || px > el.scrollLeft + el.clientWidth - 40)
    el.scrollLeft = px - el.clientWidth * 0.2
}

defineExpose({ timeAt, follow })
</script>

<style scoped>
.ztl {
  position: relative;
  --ztl-bg: color-mix(in srgb, var(--zen-bg, #1a1a1f) 70%, #000);
  /* A step darker than the theme's background, keeping its hue: mixing in black turns a light
     theme muddy. (The line above is for browsers without relative colours.) */
  --ztl-bg: oklch(from var(--zen-bg, #1a1a1f) calc(l - 0.07) c h);
  --ztl-row: color-mix(in srgb, var(--zen-text, #e5e5ea) 3%, transparent);
  --ztl-line: color-mix(in srgb, var(--zen-text, #e5e5ea) 9%, transparent);
  --ztl-accent: var(--zen-accent, #6366f1);
  --ztl-playhead: #ff5a4f;
  display: flex;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ztl-line);
  border-radius: var(--zen-radius, 7px);
  background: var(--ztl-bg);
  user-select: none;
  touch-action: none;
}
.ztl-heads {
  position: relative;
  flex: none;
  overflow: hidden;
  width: var(--ztl-head);
  border-right: 1px solid var(--ztl-line);
}
.ztl-corner {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--ztl-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  border-bottom: 1px solid var(--ztl-line);
}
.ztl-time {
  color: var(--zen-text, #e5e5ea);
  font-family: var(--zen-mono, ui-monospace, monospace);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.ztl-head {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
  padding: 0 8px;
  border-bottom: 1px solid var(--ztl-line);
  color: var(--zen-muted, #9aa0aa);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.ztl-head.movable {
  cursor: grab;
}
.ztl-head.lifted {
  position: relative;
  z-index: 6;
  background: color-mix(in srgb, var(--ztl-accent) 22%, var(--ztl-bg));
  box-shadow: 0 4px 14px rgb(0 0 0 / 45%);
  cursor: grabbing;
}
.ztl-insert {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 3;
  height: 2px;
  margin-top: -1px;
  background: var(--ztl-accent);
  pointer-events: none;
}
.ztl-head .mdi {
  flex: none;
  font-size: 13px;
}
/* A header with buttons puts them on a line of their own under the name, which keeps its width. */
.ztl-head.has-actions {
  flex-wrap: wrap;
  align-content: center;
  row-gap: 2px;
}
.ztl-head.has-actions .ztl-head-label {
  flex: 1 1 0;
}
.ztl-head-actions {
  display: flex;
  flex: 1 0 100%;
  gap: 2px;
  padding-left: 24px;
}
.ztl-head-action {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 17px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-size: 9.5px;
  font-weight: 600;
  cursor: pointer;
}
.ztl-head-action .mdi {
  font-size: 12px;
}
.ztl-head-action:hover {
  color: var(--zen-text, #e5e5ea);
}
.ztl-head-action.on {
  border-color: color-mix(in srgb, var(--ztl-accent) 55%, transparent);
  background: color-mix(in srgb, var(--ztl-accent) 22%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.ztl-head-thumb {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: calc(var(--zen-radius, 7px) / 2);
  object-fit: cover;
}
.ztl-head-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* Scrolls both ways: sideways when zoomed in, up and down when there are more tracks than the
   timeline's height shows. The track headers follow its vertical scroll (onScroll). */
.ztl-scroll {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: auto;
  scrollbar-width: none;
}
.ztl-scroll::-webkit-scrollbar {
  display: none;
}
.ztl-curve {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
}
.ztl-cstep {
  fill: none;
  stroke: color-mix(in srgb, var(--ztl-curve) 70%, transparent);
  stroke-dasharray: 3 3;
  stroke-width: 1.5;
}
.ztl-carea {
  fill: color-mix(in srgb, var(--ztl-curve) 22%, transparent);
}
.ztl-cunit {
  stroke: color-mix(in srgb, var(--zen-text, #e5e5ea) 18%, transparent);
  stroke-dasharray: 4 4;
  stroke-width: 1;
}
.ztl-cline {
  fill: none;
  stroke: var(--ztl-curve);
  stroke-width: 2.2;
  stroke-linejoin: round;
}
.ztl-cval {
  fill: var(--ztl-curve);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  paint-order: stroke;
  stroke: var(--ztl-bg);
  stroke-width: 3px;
}
.ztl-larea {
  fill: color-mix(in srgb, var(--ztl-curve) 20%, transparent);
}
.ztl-lbar {
  stroke: var(--ztl-curve);
  stroke-width: 2.5;
  stroke-linecap: round;
}
.ztl-lhit {
  stroke: transparent;
  stroke-width: 12;
  cursor: ns-resize;
}
.ztl-lseg:hover .ztl-lbar {
  stroke-width: 3.5;
}
.ztl-lseg.inherited .ztl-larea {
  fill: color-mix(in srgb, var(--ztl-curve) 10%, transparent);
}
.ztl-lseg.inherited .ztl-lbar,
.ztl-lseg.inherited .ztl-cline {
  stroke-dasharray: 5 4;
}
.ztl-lseg.inherited .ztl-carea {
  fill: color-mix(in srgb, var(--ztl-curve) 9%, transparent);
}
.ztl-lpad {
  fill: transparent;
}
.ztl-levels.shaped .ztl-lseg + .ztl-lseg .ztl-lpad {
  stroke: color-mix(in srgb, var(--zen-text, #e5e5ea) 8%, transparent);
  stroke-dasharray: 2 3;
}
.ztl-cpt {
  fill: var(--ztl-bg);
  stroke: var(--ztl-curve);
  stroke-width: 2;
  cursor: grab;
}
.ztl-cpt:hover {
  fill: var(--ztl-curve);
}
.ztl-range {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  border-right: 1px solid color-mix(in srgb, var(--ztl-accent) 60%, transparent);
  border-left: 1px solid color-mix(in srgb, var(--ztl-accent) 60%, transparent);
  background: color-mix(in srgb, var(--ztl-accent) 9%, transparent);
  pointer-events: none;
}
.ztl-range::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 4px;
  background: var(--ztl-accent);
  content: '';
}
.ztl-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  border-radius: 0 2px 2px 0;
  background: #ff5a5f;
  transition: width 0.25s ease;
  pointer-events: none;
}
.ztl-hbar {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 6;
  height: 9px;
  touch-action: none;
}
.ztl-thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 22%, transparent);
  transition: background 0.12s;
}
.ztl-hbar:hover .ztl-thumb {
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 38%, transparent);
}
.ztl-body {
  position: relative;
}
.ztl-ruler {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--ztl-bg);
  height: 24px;
  border-bottom: 1px solid var(--ztl-line);
  cursor: col-resize;
}
.ztl-tick {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 5px;
  background: var(--ztl-line);
}
.ztl-tick.major {
  height: 9px;
  background: color-mix(in srgb, var(--zen-text, #e5e5ea) 30%, transparent);
}
.ztl-tick b {
  position: absolute;
  bottom: 10px;
  left: 3px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 9.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ztl-track {
  position: relative;
  box-sizing: border-box;
  border-bottom: 1px solid var(--ztl-line);
}
/* by track index, not :nth-of-type — the range and ruler are sibling divs, so the parity would
   flip whenever a range is shown */
.ztl-track.zebra {
  background: var(--ztl-row);
}
.ztl-track.dropping {
  background: color-mix(in srgb, var(--ztl-accent) 16%, transparent);
}
.ztl-item {
  position: absolute;
  box-sizing: border-box;
  touch-action: none;
}
.ztl-item.clip {
  top: 3px;
  bottom: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, var(--ztl-color, var(--ztl-accent)) 70%, #000);
  border-radius: calc(var(--zen-radius, 7px) * 0.65);
  background: color-mix(in srgb, var(--ztl-color, var(--ztl-accent)) 42%, var(--ztl-bg));
  cursor: pointer;
}
.ztl-item.clip.on {
  border-color: var(--zen-text, #e5e5ea);
  box-shadow: 0 0 0 1px var(--zen-text, #e5e5ea) inset;
  background: color-mix(in srgb, var(--ztl-color, var(--ztl-accent)) 62%, var(--ztl-bg));
}
.ztl-item.lifted {
  z-index: 3;
  box-shadow: 0 6px 16px rgb(0 0 0 / 45%);
  cursor: grabbing;
  opacity: 0.92;
}
/* A clip standing in for something not there yet: dashed and faint. */
.ztl-item.clip.ghost {
  border-style: dashed;
  background: color-mix(in srgb, var(--ztl-color, var(--ztl-accent)) 16%, var(--ztl-bg));
}
.ztl-item.clip.muted {
  opacity: 0.4;
}
.ztl-item.clip img {
  flex: none;
  height: 100%;
  margin-left: -7px;
  aspect-ratio: 1;
  object-fit: cover;
}
.ztl-label {
  overflow: hidden;
  /* The theme's text, softened toward the clip's own colour: readable on light and dark clips
     without the weight of pure black or white. */
  color: color-mix(in srgb, var(--zen-text, #e5e5ea) 78%, var(--ztl-color, var(--ztl-accent)));
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: 0 1px 1px rgb(0 0 0 / 40%);
}
.ztl-icon {
  flex: none;
  color: #fff;
  font-size: 12px;
  opacity: 0.85;
}
.ztl-grip {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
}
.ztl-grip.end {
  right: 0;
}
.ztl-grip.start {
  left: 0;
}
.ztl-grip::after {
  content: '';
  position: absolute;
  top: 25%;
  bottom: 25%;
  left: 3px;
  width: 1px;
  background: rgb(255 255 255 / 55%);
  opacity: 0;
  transition: opacity 0.12s;
}
.ztl-item:hover .ztl-grip::after {
  opacity: 1;
}
.ztl-item.marker {
  top: 50%;
  width: 22px;
  height: 22px;
  overflow: hidden;
  transform: translate(-50%, -50%);
  border: 2px solid var(--ztl-color, #f5c542);
  border-radius: 5px;
  background: var(--ztl-bg);
  cursor: grab;
}
.ztl-item.marker:not(.thumbed):not(.ghost) {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background: var(--ztl-color, #f5c542);
  transform: translate(-50%, -50%) rotate(45deg);
}
.ztl-item.marker.on {
  border-color: #fff;
  box-shadow: 0 0 0 2px var(--ztl-accent);
}
.ztl-item.marker.ghost {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px dashed color-mix(in srgb, var(--zen-text, #e5e5ea) 35%, transparent);
  border-radius: 5px;
  background: transparent;
  color: color-mix(in srgb, var(--zen-text, #e5e5ea) 55%, transparent);
  transform: translate(-50%, -50%);
  cursor: pointer;
}
.ztl-item.marker.ghost:hover {
  border-color: var(--ztl-accent);
  color: var(--zen-text, #e5e5ea);
}
.ztl-item.marker.ghost .ztl-icon {
  color: inherit;
  font-size: 12px;
}
.ztl-item.marker img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.ztl-guide {
  position: absolute;
  top: 24px;
  bottom: 0;
  width: 0;
  border-left: 1px dashed color-mix(in srgb, var(--zen-text, #e5e5ea) 22%, transparent);
  pointer-events: none;
}
/* Where a drag has caught: an edge, the playhead. */
.ztl-snapline {
  position: absolute;
  top: 24px;
  bottom: 0;
  z-index: 3;
  width: 1px;
  background: var(--zen-accent, #6366f1);
  box-shadow: 0 0 4px var(--zen-accent, #6366f1);
  pointer-events: none;
}
/* Moved with a transform, not `left`: it slides on the compositor in sub-pixel steps every frame
   of playback without a layout. */
.ztl-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  will-change: transform;
  z-index: 6;
  width: 0;
  border-left: 1px solid var(--ztl-playhead);
  pointer-events: none;
}
.ztl-playhead span {
  position: absolute;
  top: 0;
  left: -6px;
  width: 11px;
  height: 11px;
  background: var(--ztl-playhead);
  clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
}
</style>
