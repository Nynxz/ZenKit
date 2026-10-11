<template>
  <div class="zws" :style="px(layout.bounds)" @contextmenu.prevent>
    <div v-if="!layout.tiles.size" class="zws-empty">
      <i class="mdi mdi-view-dashboard-outline" />
      <b>{{ current?.name }} is empty</b>
      <span>
        Drag a panel here, or use
        <i class="mdi mdi-view-grid-plus-outline" />
        in its title bar.
      </span>
      <span>Drop at an edge to tile beside the rest; hold Shift to split any tile.</span>
      <span class="zws-keys">
        <kbd>Alt</kbd>
        +
        <kbd>`</kbd>
        back to the graph ·
        <kbd>Alt</kbd>
        +
        <kbd>1–9</kbd>
        switch workspace
      </span>
    </div>
  </div>
  <ZenResizeHandle
    v-for="d in layout.dividers"
    :key="d.path"
    class="zws-gutter"
    :orientation="d.axis === 'row' ? 'vertical' : 'horizontal'"
    :active="dragging.includes(d.path)"
    label="Resize tiled panels"
    :value="Math.round(d.ratio * 100)"
    :min="Math.round(clampTileRatio(0, d.length) * 100)"
    :max="Math.round(clampTileRatio(1, d.length) * 100)"
    :value-text="`${Math.round(d.ratio * 100)}%`"
    :style="px(grow(d.rect, d.axis))"
    :title="'Drag to resize · double-click to even out'"
    @drag-start="startResize($event, [d])"
    @drag-move="moveResize"
    @drag-end="finishResize"
    @nudge="nudge([d], $event)"
    @limit="limit([d], $event)"
    @reset="even([d])"
    @toggle="even([d])"
  />
  <ZenResizeHandle
    v-for="j in junctions"
    :key="j.key"
    class="zws-junction"
    orientation="both"
    label="Resize tiled panels in both directions"
    :active="dragging.includes(j.v.path) && dragging.includes(j.h.path)"
    :style="{ left: `${j.x - 7}px`, top: `${j.y - 7}px` }"
    title="Drag to resize both ways · double-click to even out"
    @drag-start="startResize($event, [j.v, j.h])"
    @drag-move="moveResize"
    @drag-end="finishResize"
    @nudge="(pixels, axis) => nudge([axis === 'x' ? j.v : j.h], pixels)"
    @limit="limit([j.v, j.h], $event)"
    @reset="even([j.v, j.h])"
    @toggle="even([j.v, j.h])"
  />
  <!-- A tile held for a panel waiting to reopen there (a node's panel stepping back in as the
       workspace shows): its title and icon over an empty body, where the panel will be. -->
  <div
    v-for="t in waitingTiles"
    :key="t.id"
    class="zws-wait"
    :style="px(t.rect)"
    :data-zen-waiting="t.id"
    aria-hidden="true"
  >
    <div class="zws-wait-bar">
      <ZenIcon class="zws-wait-icon" :icon="t.icon" />
      <span class="zws-wait-title">{{ t.title }}</span>
    </div>
  </div>
  <div v-if="ws.preview" class="zws-preview" :style="px(ws.preview)" />
</template>

<script setup lang="ts">
// The active workspace's surface: covers the graph where the canvas is, draws the gutters between
// tiles (drag to resize, double-click to even out), and previews where a dragged panel would tile.
// The tiled panels themselves are ordinary ZenPanels placed by their tile rect.
import { computed, inject, ref } from 'vue'
import { ZenIcon, ZenResizeHandle } from '@nynxz/zenkit-ui'
import { STORE_KEY, type PanelStore } from '../panelStore'
import type { Rect } from '../types'
import {
  clampTileRatio,
  commitLayout,
  setRatio,
  waitingTiles,
  ws,
  wsLayout,
  type Divider,
} from '../workspaces'

const store = inject(STORE_KEY) as PanelStore
const layout = wsLayout
const current = computed(() => ws.list.find((w) => w.id === ws.active))
const dragging = ref<string[]>([])

/** Where a horizontal gutter ends against a vertical one (a T or a cross): dragging there moves
 *  both splits at once. */
const junctions = computed(() => {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  const out: { key: string; v: Divider; h: Divider; x: number; y: number }[] = []
  const ds = layout.value.dividers
  for (const v of ds.filter((d) => d.axis === 'row')) {
    for (const h of ds.filter((d) => d.axis === 'column')) {
      const y = h.rect.y + h.rect.h / 2
      if (y < v.rect.y || y > v.rect.y + v.rect.h) continue
      if (near(h.rect.x, v.rect.x + v.rect.w) || near(h.rect.x + h.rect.w, v.rect.x))
        out.push({ key: `${v.path}|${h.path}`, v, h, x: v.rect.x + v.rect.w / 2, y })
    }
  }
  return out
})

const px = (r: Rect) => ({
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${r.w}px`,
  height: `${r.h}px`,
})
/** Gutters are as thin as the gap; give the pointer a wider strip to catch. */
function grow(r: Rect, axis: Divider['axis']): Rect {
  const extra = Math.max(0, 10 - (axis === 'row' ? r.w : r.h)) / 2
  return axis === 'row'
    ? { ...r, x: r.x - extra, w: r.w + extra * 2 }
    : { ...r, y: r.y - extra, h: r.h + extra * 2 }
}

/** Drag one divider, or two at a junction: each follows the pointer along its own axis. */
let resize: {
  ds: Divider[]
  sx: number
  sy: number
  from: number[]
  latest: number[]
  workspaceId: string | null
} | null = null
let frame = 0
function startResize(e: PointerEvent, ds: Divider[]) {
  const from = ds.map((d) => d.ratio)
  resize = { ds, sx: e.clientX, sy: e.clientY, from, latest: [...from], workspaceId: ws.active }
  dragging.value = ds.map((d) => d.path)
  store._ops.setInteract(
    true,
    ds.length > 1 ? 'move' : ds[0]!.axis === 'row' ? 'col-resize' : 'row-resize',
  )
}
function apply(ratios: number[]) {
  if (resize) {
    const { ds, workspaceId } = resize
    ds.forEach((d, i) => setRatio(d.path, ratios[i]!, workspaceId))
  }
}
function moveResize(e: PointerEvent) {
  if (!resize) return
  const { ds, sx, sy, from } = resize
  resize.latest = ds.map((d, i) => {
    const delta = d.axis === 'row' ? e.clientX - sx : e.clientY - sy
    return clampTileRatio(from[i]! + delta / d.length, d.length)
  })
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      if (resize) apply(resize.latest)
    })
}
function finishResize(cancelled: boolean) {
  cancelAnimationFrame(frame)
  frame = 0
  if (resize) apply(cancelled ? resize.from : resize.latest)
  resize = null
  dragging.value = []
  store._ops.setInteract(false)
  // The workflow's file takes the result once, not every frame of the drag.
  if (!cancelled) commitLayout()
}
function nudge(ds: Divider[], pixels: number) {
  ds.forEach((d) => setRatio(d.path, clampTileRatio(d.ratio + pixels / d.length, d.length)))
  commitLayout()
}
function limit(ds: Divider[], edge: 'min' | 'max') {
  ds.forEach((d) => setRatio(d.path, clampTileRatio(edge === 'min' ? 0 : 1, d.length)))
  commitLayout()
}
function even(ds: Divider[]) {
  ds.forEach((d) => setRatio(d.path, 0.5))
  commitLayout()
}
</script>

<style scoped>
.zws {
  position: fixed;
  z-index: 2;
  background: var(--zen-bg, #1a1a1f);
}
.zws-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 12.5px;
  text-align: center;
  pointer-events: none;
}
.zws-empty > .mdi {
  margin-bottom: 4px;
  font-size: 40px;
  opacity: 0.6;
}
.zws-empty b {
  color: var(--zen-text, #e5e5ea);
  font-size: 14px;
}
.zws-keys {
  margin-top: 8px;
  font-size: 11px;
}
kbd {
  padding: 1px 5px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: 4px;
  background: var(--zen-surface, #202026);
  font-family: inherit;
  font-size: 10.5px;
}
/* Looks like the tiled panel it stands in for (ZenPanel's tiled frame and title bar), with nothing
   in it: when the panel opens over it, nothing moves. */
.zws-wait {
  position: fixed;
  z-index: 3;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--zen-surface-border, var(--zen-border, #3a3a44)) 86%, transparent);
  border-radius: var(--zen-radius-surface, var(--zen-radius, 10px));
  background: var(--zen-chrome-bg, var(--zen-bg, #1a1a1f));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  color: var(--zen-text, #e5e5ea);
  font-family: var(--p-font-family, -apple-system, system-ui, sans-serif);
  pointer-events: none;
}
.zws-wait-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 6px 0 11px;
  border-bottom: 1px solid
    color-mix(in srgb, var(--zen-surface-border, var(--zen-border, #3a3a44)) 85%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--zen-chrome-bg, var(--zen-surface, #202026)) 92%, transparent),
    color-mix(in srgb, var(--zen-chrome-bg, var(--zen-surface, #202026)) 62%, transparent)
  );
}
.zws-wait-icon {
  color: var(--zen-accent, #3b82f6);
  font-size: 14px;
}
.zws-wait-title {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.003em;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zws-gutter {
  position: fixed;
  z-index: 4;
  touch-action: none;
}
.zws-preview {
  position: fixed;
  z-index: 5;
  box-sizing: border-box;
  border: 2px solid var(--zen-accent, #3b82f6);
  border-radius: var(--zen-radius-surface, var(--zen-radius, 10px));
  background: color-mix(in srgb, var(--zen-accent, #3b82f6) 16%, transparent);
  pointer-events: none;
  transition:
    left 0.09s,
    top 0.09s,
    width 0.09s,
    height 0.09s;
}
.zws-junction {
  position: fixed;
  z-index: 6;
  width: 14px;
  height: 14px;
  cursor: move;
  touch-action: none;
}
</style>
