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
  <div
    v-for="d in layout.dividers"
    :key="d.path"
    class="zws-gutter"
    :class="[d.axis, { on: dragging.includes(d.path) }]"
    :style="px(grow(d.rect, d.axis))"
    :title="'Drag to resize · double-click to even out'"
    @pointerdown="startResize($event, [d])"
    @dblclick="setRatio(d.path, 0.5)"
  />
  <div
    v-for="j in junctions"
    :key="j.key"
    class="zws-junction"
    :class="{ on: dragging.includes(j.v.path) && dragging.includes(j.h.path) }"
    :style="{ left: `${j.x - 7}px`, top: `${j.y - 7}px` }"
    title="Drag to resize both ways · double-click to even out"
    @pointerdown="startResize($event, [j.v, j.h])"
    @dblclick="(setRatio(j.v.path, 0.5), setRatio(j.h.path, 0.5))"
  />
  <div v-if="ws.preview" class="zws-preview" :style="px(ws.preview)" />
</template>

<script setup lang="ts">
// The active workspace's surface: covers the graph where the canvas is, draws the gutters between
// tiles (drag to resize, double-click to even out), and previews where a dragged panel would tile.
// The tiled panels themselves are ordinary ZenPanels placed by their tile rect.
import { computed, inject, ref } from 'vue'
import { STORE_KEY, type PanelStore } from '../panelStore'
import type { Rect } from '../types'
import { clampTileRatio, setRatio, ws, wsLayout, type Divider } from '../workspaces'

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
function startResize(e: PointerEvent, ds: Divider[]) {
  if (e.button !== 0) return
  e.preventDefault()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  const sx = e.clientX
  const sy = e.clientY
  const from = ds.map((d) => d.ratio)
  dragging.value = ds.map((d) => d.path)
  const cursor = ds.length > 1 ? 'move' : ds[0]!.axis === 'row' ? 'col-resize' : 'row-resize'
  store._ops.setInteract(true, cursor)
  // One re-layout per frame however fast the pointer reports.
  let frame = 0
  let latest = [...from]
  const apply = (ratios: number[]) => ds.forEach((d, i) => setRatio(d.path, ratios[i]!))
  const onMove = (m: PointerEvent) => {
    latest = ds.map((d, i) => {
      const delta = d.axis === 'row' ? m.clientX - sx : m.clientY - sy
      return clampTileRatio(from[i]! + delta / d.length, d.length)
    })
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        apply(latest)
      })
  }
  const finish = (commit: boolean) => {
    cancelAnimationFrame(frame)
    frame = 0
    apply(commit ? latest : from)
    dragging.value = []
    store._ops.setInteract(false)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('keydown', onKey, true)
  }
  const onUp = () => finish(true)
  const onKey = (k: KeyboardEvent) => {
    if (k.key !== 'Escape') return
    k.preventDefault()
    finish(false)
  }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('keydown', onKey, true)
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
.zws-gutter {
  position: fixed;
  z-index: 4;
  touch-action: none;
}
.zws-gutter.row {
  cursor: col-resize;
}
.zws-gutter.column {
  cursor: row-resize;
}
.zws-gutter::after {
  position: absolute;
  inset: 0;
  margin: auto;
  border-radius: 2px;
  background: var(--zen-accent, #6366f1);
  opacity: 0;
  content: '';
  transition: opacity 0.12s;
}
.zws-gutter.row::after {
  width: 2px;
}
.zws-gutter.column::after {
  height: 2px;
}
.zws-gutter:hover::after,
.zws-gutter.on::after {
  opacity: 0.9;
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
.zws-junction::after {
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--zen-accent, #6366f1);
  opacity: 0;
  content: '';
  transition: opacity 0.12s;
}
.zws-junction:hover::after,
.zws-junction.on::after {
  opacity: 0.95;
}
</style>

<style>
/* The workspace-to-workspace slide (see `slideFrom` in workspaces.ts). Unscoped: it reaches the
   tiled panels, which are ZenPanels. */
@media (prefers-reduced-motion: no-preference) {
  html[data-zen-ws-enter='right'] body:not(.disable-animations) .zp[data-zen-tiled],
  html[data-zen-ws-enter='right'] body:not(.disable-animations) .zws-empty {
    animation: zen-ws-in-right 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  html[data-zen-ws-enter='left'] body:not(.disable-animations) .zp[data-zen-tiled],
  html[data-zen-ws-enter='left'] body:not(.disable-animations) .zws-empty {
    animation: zen-ws-in-left 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
@keyframes zen-ws-in-right {
  from {
    transform: translateX(48px);
    opacity: 0;
  }
}
@keyframes zen-ws-in-left {
  from {
    transform: translateX(-48px);
    opacity: 0;
  }
}
</style>
