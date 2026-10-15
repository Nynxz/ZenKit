/**
 * A list reordered by dragging one row, the rows around it making room as it goes — where it will
 * land is shown before the drop, not after. Pure maths over measurements the host takes once, at
 * the grab; the host owns the rows, the pointer and the commit.
 *
 * Measurements are in one space throughout: layout pixels (`offsetTop` / `offsetHeight`) with the
 * pointer's delta divided by any canvas zoom, or client pixels for both. Mixing them is how a row
 * lands one slot off at a zoom other than 1.
 */

/** Where a row dragged from `from` lands, given every row's midpoint and the dragged row's centre
 *  now: past as many other rows' midpoints as it has crossed, kept within `lo`..`hi` (pinned rows
 *  at either end stay put). */
export function insertionIndex(
  mids: number[],
  from: number,
  center: number,
  lo = 0,
  hi = mids.length - 1,
): number {
  const passed = mids.filter((m, k) => k !== from && m < center).length
  return Math.min(hi, Math.max(lo, passed))
}

/** Which way row `index` moves aside while the row at `from` is held over `to`: -1 up a slot,
 *  1 down a slot, 0 where it is (it isn't between them, or it is the one being dragged). */
export function sortShift(index: number, from: number, to: number): -1 | 0 | 1 {
  if (from < 0 || to < 0 || index === from) return 0
  if (from < to && index > from && index <= to) return -1
  if (from > to && index < from && index >= to) return 1
  return 0
}

/** How far a row moves aside: the dragged row's height plus the gap that goes with it, so rows of
 *  any heights make exactly the room the dragged one needs. `tops` and `heights` per row. */
export function rowStride(tops: number[], heights: number[], from: number): number {
  const height = heights[from] ?? 0
  const next = tops[from + 1]
  if (next !== undefined) return next - (tops[from] ?? 0)
  const before = tops[from - 1]
  if (before !== undefined) return (tops[from] ?? 0) - before - (heights[from - 1] ?? 0) + height
  return height
}

/** A row that moves aside, as a style: `translateY` by `shift` strides. */
export function shiftStyle(shift: number, stride: number): Record<string, string> | undefined {
  return shift ? { transform: `translateY(${shift * stride}px)` } : undefined
}
