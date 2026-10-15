// Box geometry for ZenBoxCanvas, kept pure so it can be tested without a DOM.
//
// Every box lives in 0..1 space over the canvas — x/w as fractions of its width, y/h of its height —
// so it survives a resolution change and means the same thing to the host and the backend. The one
// place pixels matter is the aspect ratio, which `resize` needs to keep a box square when Shift is
// held; it is passed in rather than assumed.

export interface ZenBox {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Border and fill colour. */
  color?: string
  /** Drawn in the box's corner tag. */
  label?: string
  /** Not drawn at all. */
  hidden?: boolean
  /** Drawn, selectable, never moved or resized. */
  locked?: boolean
  /** Box-local mask: an image whose ALPHA is the shape, stretched over the box. None = the box. */
  mask?: string | null
  /** What the canvas shows for the mask, when it differs from the mask being edited (a grown or
   *  processed view of it). Painting and resizing work on `mask`. */
  maskView?: string | null
  /** Whether the box is drawn clipped to its mask (default true). False keeps the box whole on
   *  the canvas and hands the mask only to the `box` slot's `maskStyle`, for a mask that shapes
   *  something inside the box rather than the box itself. Painting edits the mask either way. */
  maskClips?: boolean
}

export type BoxRect = Pick<ZenBox, 'x' | 'y' | 'w' | 'h'>
export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const BOX_HANDLES: readonly BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Round to the nearest multiple of `step`; `step <= 0` leaves the value alone. */
export function snapTo(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v
}

/** The rect two corners span, in either order, clamped to the canvas. */
export function spanRect(ax: number, ay: number, bx: number, by: number): BoxRect {
  const x0 = clamp01(Math.min(ax, bx))
  const y0 = clamp01(Math.min(ay, by))
  return { x: x0, y: y0, w: clamp01(Math.max(ax, bx)) - x0, h: clamp01(Math.max(ay, by)) - y0 }
}

/** `rect` moved by (dx, dy), kept wholly on the canvas. */
export function moveRect(rect: BoxRect, dx: number, dy: number, step = 0): BoxRect {
  const x = Math.min(1 - rect.w, Math.max(0, snapTo(rect.x + dx, step)))
  const y = Math.min(1 - rect.h, Math.max(0, snapTo(rect.y + dy, step)))
  return { ...rect, x, y }
}

/**
 * `rect` with the edges a handle owns moved by (dx, dy). The opposite edges stay put, a box can't
 * shrink below `min`, and with `keepAspect` the box keeps its shape on screen — `aspect` is the
 * canvas's width / height, because equal fractions are not equal pixels on a non-square canvas.
 */
export function resizeRect(
  rect: BoxRect,
  handle: BoxHandle,
  dx: number,
  dy: number,
  opts: { min?: number; step?: number; keepAspect?: boolean; aspect?: number } = {},
): BoxRect {
  const { min = 0.01, step = 0, keepAspect = false, aspect = 1 } = opts
  let x0 = rect.x
  let y0 = rect.y
  let x1 = rect.x + rect.w
  let y1 = rect.y + rect.h
  if (handle.includes('w')) x0 = Math.min(x1 - min, clamp01(snapTo(x0 + dx, step)))
  if (handle.includes('e')) x1 = Math.max(x0 + min, clamp01(snapTo(x1 + dx, step)))
  if (handle.includes('n')) y0 = Math.min(y1 - min, clamp01(snapTo(y0 + dy, step)))
  if (handle.includes('s')) y1 = Math.max(y0 + min, clamp01(snapTo(y1 + dy, step)))

  if (keepAspect && rect.w > 0 && rect.h > 0) {
    const kept = keepShape(rect, handle, x1 - x0, y1 - y0, aspect)
    if (kept) return kept
    return rect
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * The box a handle drags to `w` x `h`, reshaped to `rect`'s on-screen proportions: a corner keeps
 * its opposite corner pinned, an edge keeps the opposite edge and the box's centre line. Null when
 * the result would leave the canvas.
 */
function keepShape(
  rect: BoxRect,
  handle: BoxHandle,
  w: number,
  h: number,
  aspect: number,
): BoxRect | null {
  const shape = (rect.w * aspect) / rect.h
  const horizontal = handle === 'e' || handle === 'w'
  const vertical = handle === 'n' || handle === 's'
  if (horizontal) h = (w * aspect) / shape
  else if (vertical) w = (h * shape) / aspect
  else if ((w * aspect) / h > shape) w = (h * shape) / aspect
  else h = (w * aspect) / shape

  const x = handle.includes('w')
    ? rect.x + rect.w - w
    : vertical
      ? rect.x + (rect.w - w) / 2
      : rect.x
  const y = handle.includes('n')
    ? rect.y + rect.h - h
    : horizontal
      ? rect.y + (rect.h - h) / 2
      : rect.y
  if (x < 0 || y < 0 || x + w > 1 || y + h > 1) return null
  return { x, y, w, h }
}

/** Whether two rects overlap at all. */
export function intersects(a: BoxRect, b: BoxRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** The rect holding every one of `rects`, or null for none. */
export function boundsOf(rects: BoxRect[]): BoxRect | null {
  if (!rects.length) return null
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w))
  const y1 = Math.max(...rects.map((r) => r.y + r.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Each of `rects` scaled with the group: `from` is the group's bounds before, `to` after. */
export function scaleWithin(rect: BoxRect, from: BoxRect, to: BoxRect): BoxRect {
  const sx = from.w > 0 ? to.w / from.w : 1
  const sy = from.h > 0 ? to.h / from.h : 1
  return {
    x: to.x + (rect.x - from.x) * sx,
    y: to.y + (rect.y - from.y) * sy,
    w: rect.w * sx,
    h: rect.h * sy,
  }
}

/** The topmost box under a canvas point (boxes are bottom→top), skipping hidden ones. */
export function boxAt<T extends ZenBox>(boxes: T[], x: number, y: number): T | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!
    if (!b.hidden && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b
  }
  return null
}

/** Every visible box under a canvas point, topmost first. */
export function boxesAt<T extends ZenBox>(boxes: T[], x: number, y: number): T[] {
  const out: T[] = []
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!
    if (!b.hidden && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) out.push(b)
  }
  return out
}

/** The box after `id` going down a topmost-first stack, wrapping to the top; the top if `id` isn't
 *  in it. How a click cycles through boxes stacked under one point. */
export function nextBelow<T extends ZenBox>(stack: T[], id: string | undefined): T | undefined {
  const at = stack.findIndex((b) => b.id === id)
  return at < 0 ? stack[0] : stack[(at + 1) % stack.length]
}

/**
 * Where a mask painted over the frame `paint` sits inside the box `box`, as fractions of the box:
 * `[left, top, width, height]`. A resize changes the box but not where the paint is on the canvas,
 * so the mask's frame stays put and the box crops or extends around it.
 */
export function paintFrame(paint: BoxRect, box: BoxRect): [number, number, number, number] {
  const w = box.w || 1
  const h = box.h || 1
  return [(paint.x - box.x) / w, (paint.y - box.y) / h, paint.w / w, paint.h / h]
}

/** CSS `mask-size` and `mask-position` that place a mask painted over `paint` inside `box`.
 *  A percentage position aligns that point of the image with the same point of the box, so the
 *  offset is divided by the size difference; equal sizes need no offset. */
export function paintMaskCss(paint: BoxRect, box: BoxRect): { size: string; position: string } {
  const [left, top, width, height] = paintFrame(paint, box)
  const pos = (offset: number, size: number) =>
    Math.abs(1 - size) < 1e-6 ? 0 : (offset / (1 - size)) * 100
  const pct = (v: number) => `${Math.round(v * 1e4) / 1e4}%`
  return {
    size: `${pct(width * 100)} ${pct(height * 100)}`,
    position: `${pct(pos(left, width))} ${pct(pos(top, height))}`,
  }
}
