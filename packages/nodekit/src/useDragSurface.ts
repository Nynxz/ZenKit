// A pointer-drag on a node body. Capture, move/up/cancel and coordinate math live here; the
// CSS rules and `data-zen-drag` stay the component's job (see mountWidget's header).
//
//     .my-surface { touch-action: none; user-select: none; }
//     .my-surface > * { pointer-events: none; }
//
// Two coordinate forms, both because the node body sits in a CSS-transformed container:
//
//   * `ratio` — (clientX - rect.left) / rect.width. Zoom-immune; use for "where in this surface".
//   * `delta` — pixels since press divided by the live scale (rect.width / offsetWidth). Use for
//     "how far has it moved". Raw clientX deltas are only correct at 100% zoom.
//
// Drive state from `start + delta` captured at press, not the cursor's absolute position, or
// whatever was grabbed teleports to the cursor on the first pixel of movement.

import { ref, type Ref } from 'vue'

export interface DragContext {
  /** Pointer position within the surface, 0..1 on each axis. Immune to canvas zoom. */
  ratio: { x: number; y: number }
  /** Movement since the press as a FRACTION of the surface. The right partner for `ratio` —
   *  use `grabbedAt + deltaRatio.x` to move something that lives in 0..1 space. */
  deltaRatio: { x: number; y: number }
  /** Movement since the press in ELEMENT-space pixels (canvas zoom divided out). For state
   *  measured in real units — pixel dimensions, degrees. Do NOT divide this by `rect.width` to
   *  get a fraction: `rect` is post-transform and `delta` is not, so they only agree at 100%
   *  zoom. That is what `deltaRatio` is for. */
  delta: { x: number; y: number }
  /** The surface's live bounding rect (post-transform, i.e. screen space). */
  rect: DOMRect
  event: PointerEvent
}

export interface DragSurfaceOptions {
  /** Press landed. Return false to ignore it (e.g. nothing grabbable there). */
  onStart?: (ctx: DragContext) => boolean | void
  onMove: (ctx: DragContext) => void
  /** Released, cancelled, or capture lost — always paired with a started drag. Commit here:
   *  persisting on every move would write hundreds of snapshots and dirty the graph each time. */
  onEnd?: (ctx: DragContext) => void
}

export interface DragSurface {
  /** Bind to the surface element: `<div :ref="drag.el" v-bind="drag.handlers">`. */
  el: Ref<HTMLElement | null>
  /** Spread onto the surface — covers up, cancel AND lostpointercapture. */
  handlers: Record<string, (e: PointerEvent) => void>
  dragging: Ref<boolean>
}

export function useDragSurface(opts: DragSurfaceOptions): DragSurface {
  const el = ref<HTMLElement | null>(null)
  const dragging = ref(false)
  let startX = 0
  let startY = 0

  function context(e: PointerEvent): DragContext | null {
    const node = el.value
    if (!node) return null
    const rect = node.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    // Live canvas scale: post-transform width over layout width. 1 in the 1.0 renderer.
    const scale = rect.width / (node.offsetWidth || rect.width) || 1
    return {
      ratio: {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      },
      // Both numerator and denominator are screen-space here, so the transform cancels out.
      deltaRatio: {
        x: (e.clientX - startX) / rect.width,
        y: (e.clientY - startY) / rect.height,
      },
      delta: { x: (e.clientX - startX) / scale, y: (e.clientY - startY) / scale },
      rect,
      event: e,
    }
  }

  function down(e: PointerEvent): void {
    startX = e.clientX
    startY = e.clientY
    const ctx = context(e)
    if (!ctx) return
    if (opts.onStart?.(ctx) === false) return
    dragging.value = true
    // Capture on the SURFACE, never on a child: children re-render mid-drag, and a captured
    // pointer whose target is removed drops the gesture.
    try {
      el.value?.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }
  }

  function move(e: PointerEvent): void {
    if (!dragging.value) return
    const ctx = context(e)
    if (ctx) opts.onMove(ctx)
  }

  function end(e: PointerEvent): void {
    if (!dragging.value) return
    dragging.value = false
    try {
      el.value?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    const ctx = context(e)
    if (ctx) opts.onEnd?.(ctx)
  }

  return {
    el,
    dragging,
    handlers: {
      onPointerdown: down,
      onPointermove: move,
      onPointerup: end,
      // Both matter. `pointercancel` fires when the browser claims the gesture (the
      // touch-action trap); `lostpointercapture` fires if capture is taken away another way.
      // Miss either and a drag can get stuck "on" with the button already released.
      onPointercancel: end,
      onLostpointercapture: end,
    },
  }
}
