import type { Rect } from './types'

// A floating panel sits under ComfyUI's sidebar, side panels and top-row controls (see ZenHost).
// Dropped with its title bar under one of them, it moves the least it can to come out.

/** Clearance left between a moved panel and what covered it. */
const GAP = 8
/** Spacing of the points sampled along the title bar. */
const STEP = 16

/** How far `panel` moves (down, right or left, whichever is least and stays on screen) to take
 *  its title bar `strip` out from under `box`. Null when no move fits. */
export function clearMove(
  panel: Rect,
  strip: Rect,
  box: Rect,
  view: { w: number; h: number },
): { dx: number; dy: number } | null {
  const moves = [
    { dx: 0, dy: box.y + box.h + GAP - strip.y },
    { dx: box.x + box.w + GAP - panel.x, dy: 0 },
    { dx: box.x - GAP - (panel.x + panel.w), dy: 0 },
  ].filter(
    ({ dx, dy }) =>
      panel.x + dx >= 0 && panel.x + dx + panel.w <= view.w && panel.y + dy + panel.h <= view.h,
  )
  if (!moves.length) return null
  return moves.reduce((a, b) => (Math.abs(b.dx + b.dy) < Math.abs(a.dx + a.dy) ? b : a))
}

const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })
const viewSized = (r: DOMRect) => r.width >= innerWidth - 1 && r.height >= innerHeight - 1

/** The piece of ComfyUI chrome a hit element belongs to: its outermost ancestor that still takes
 *  the pointer. ComfyUI's overlays are pointer-events: none with live pieces inside (the sidebar,
 *  a top-row control), so this stops at the piece, not the whole overlay. */
function pieceOf(hit: Element): Element {
  let el = hit
  for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
    if (getComputedStyle(up).pointerEvents === 'none' || viewSized(up.getBoundingClientRect()))
      break
    el = up
  }
  return el
}
/** Passing things a panel shouldn't move for: toasts and alerts. */
const transient = (el: Element) => !!el.closest('[role="alert"], [role="status"], [class*="toast"]')

/** What sits on top of the title bar `strip`, apart from ZenKit's own layers: one box per piece. */
export function coveringBoxes(strip: Rect): Rect[] {
  const boxes = new Map<Element, Rect>()
  for (const y of [strip.y + strip.h * 0.3, strip.y + strip.h * 0.7])
    for (let x = strip.x + 4; x < strip.x + strip.w; x += STEP) {
      const hit = document.elementFromPoint(x, y)
      if (!hit || hit.closest('.zen-layer') || transient(hit)) continue
      const piece = pieceOf(hit)
      if (!boxes.has(piece)) boxes.set(piece, toRect(piece.getBoundingClientRect()))
    }
  return [...boxes.values()]
}
