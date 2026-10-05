// Tiling engine, ported from nynxzcom's @nynxz/panels (packages/panels/src/tiling.ts).
// Pure: trees in, trees out; layout in linear %+px coordinates.
import type { Rect } from '../types'

type Id = string

export type Side = 'left' | 'right' | 'top' | 'bottom'

/** `row`: children side by side (a left, b right). `column`: stacked (a top, b bottom). */
export type SplitAxis = 'row' | 'column'

/**
 * Tiled windows form a binary tree: every split divides its area between two
 * subtrees at `ratio` (the share `a` gets).
 */
export type TileNode =
  | { type: 'leaf'; id: Id }
  | { type: 'split'; axis: SplitAxis; ratio: number; a: TileNode; b: TileNode }

/** A split's address: "" is the root, then "a"/"b" per level down. */
export type TilePath = string

/** Where a window joins the tiling. */
export type TileTarget =
  /** Split the whole layout: the window takes that side of everything. */
  (
    | { kind: 'edge'; side: Side }
    /** Split one tile: the window takes that side of it. */
    | { kind: 'tile'; of: Id; side: Side }
  ) & {
    /** The window's share of the new split, 0–1. Defaults to half. */
    share?: number
  }

const axisOf = (side: Side): SplitAxis => (side === 'left' || side === 'right' ? 'row' : 'column')
const leads = (side: Side) => side === 'left' || side === 'top'

// ---------------------------------------------------------------------------
// Tree edits. All pure; they return new trees and never mutate.

export function hasTile(tree: TileNode | null, id: Id): boolean {
  if (!tree) return false
  return tree.type === 'leaf' ? tree.id === id : hasTile(tree.a, id) || hasTile(tree.b, id)
}

/** Add `id` to the tree at `target`. A tile target that isn't in the tree acts as an edge. */
export function insertTile(tree: TileNode | null, id: Id, target: TileTarget): TileNode {
  const leaf: TileNode = { type: 'leaf', id }
  if (!tree) return leaf
  const share = Math.min(Math.max(target.share ?? 0.5, 0.05), 0.95)
  const pair = (other: TileNode): TileNode => ({
    type: 'split',
    axis: axisOf(target.side),
    // `ratio` is `a`'s share; the window is `a` when it leads.
    ratio: leads(target.side) ? share : 1 - share,
    a: leads(target.side) ? leaf : other,
    b: leads(target.side) ? other : leaf,
  })
  if (target.kind === 'edge' || !hasTile(tree, target.of)) return pair(tree)
  const of = target.of
  const visit = (node: TileNode): TileNode => {
    if (node.type === 'leaf') return node.id === of ? pair(node) : node
    return { ...node, a: visit(node.a), b: visit(node.b) }
  }
  return visit(tree)
}

/** Remove `id`; its sibling takes the parent's whole area. */
export function removeTile(tree: TileNode | null, id: Id): TileNode | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree.id === id ? null : tree
  const a = removeTile(tree.a, id)
  const b = removeTile(tree.b, id)
  if (!a) return b
  if (!b) return a
  return a === tree.a && b === tree.b ? tree : { ...tree, a, b }
}

export function setTileRatio(
  tree: TileNode | null,
  path: TilePath,
  ratio: number,
): TileNode | null {
  if (!tree) return null
  if (path === '') return tree.type === 'split' ? { ...tree, ratio } : tree
  if (tree.type === 'leaf') return tree
  const [head, rest] = [path[0], path.slice(1)]
  return head === 'a'
    ? { ...tree, a: setTileRatio(tree.a, rest, ratio)! }
    : { ...tree, b: setTileRatio(tree.b, rest, ratio)! }
}

export function tileAt(tree: TileNode | null, path: TilePath): TileNode | null {
  let node = tree
  for (const step of path) {
    if (!node || node.type === 'leaf') return null
    node = step === 'a' ? node.a : node.b
  }
  return node
}

// ---------------------------------------------------------------------------
// Layout. Every coordinate is linear in the desktop size: `p` of the full length plus
// `px` pixels. One computation then serves both exact pixels (for gestures) and CSS
// `calc()` (for a first paint that is right at any size, before anything measures).

/** `p` × the full width (or height) + `px`. */
export interface Lin {
  p: number
  px: number
}

/** x and w run along the width; y and h along the height. */
export interface LinRect {
  x: Lin
  y: Lin
  w: Lin
  h: Lin
}

const lin = (p: number, px: number): Lin => ({ p, px })
const plus = (...ls: (Lin | number)[]): Lin =>
  ls.reduce<Lin>(
    (sum, l) => (typeof l === 'number' ? lin(sum.p, sum.px + l) : lin(sum.p + l.p, sum.px + l.px)),
    lin(0, 0),
  )
const times = (l: Lin, k: number): Lin => lin(l.p * k, l.px * k)

export interface SplitLayout {
  path: TilePath
  axis: SplitAxis
  ratio: number
  /** The whole area this split divides. */
  area: LinRect
  /** The gutter between its two sides. */
  gutter: LinRect
}

export interface TileLayout {
  tiles: Map<Id, LinRect>
  /** Only splits whose two sides both have a visible tile. */
  splits: SplitLayout[]
}

/**
 * Lay out the visible tiles within the desktop, `gap` px around and between them.
 * Invisible leaves (minimized windows) keep their place in the tree but take no space:
 * their sibling fills the split, and the tile comes back where it was.
 */
export function layoutTiles(
  tree: TileNode | null,
  gap: number,
  visible: (id: Id) => boolean = () => true,
): TileLayout {
  const tiles = new Map<Id, LinRect>()
  const splits: SplitLayout[] = []

  const shows = (node: TileNode): boolean =>
    node.type === 'leaf' ? visible(node.id) : shows(node.a) || shows(node.b)

  const place = (node: TileNode, area: LinRect, path: TilePath) => {
    if (node.type === 'leaf') {
      if (visible(node.id)) tiles.set(node.id, area)
      return
    }
    const [showA, showB] = [shows(node.a), shows(node.b)]
    if (!showA || !showB) {
      if (showA) place(node.a, area, path + 'a')
      if (showB) place(node.b, area, path + 'b')
      return
    }
    if (node.axis === 'row') {
      const aw = times(plus(area.w, -gap), node.ratio)
      const bw = times(plus(area.w, -gap), 1 - node.ratio)
      place(node.a, { ...area, w: aw }, path + 'a')
      place(node.b, { ...area, x: plus(area.x, aw, gap), w: bw }, path + 'b')
      splits.push({
        path,
        axis: 'row',
        ratio: node.ratio,
        area,
        gutter: { x: plus(area.x, aw), y: area.y, w: lin(0, gap), h: area.h },
      })
    } else {
      const ah = times(plus(area.h, -gap), node.ratio)
      const bh = times(plus(area.h, -gap), 1 - node.ratio)
      place(node.a, { ...area, h: ah }, path + 'a')
      place(node.b, { ...area, y: plus(area.y, ah, gap), h: bh }, path + 'b')
      splits.push({
        path,
        axis: 'column',
        ratio: node.ratio,
        area,
        gutter: { x: area.x, y: plus(area.y, ah), w: area.w, h: lin(0, gap) },
      })
    }
  }

  if (tree) {
    place(tree, { x: lin(0, gap), y: lin(0, gap), w: lin(1, -2 * gap), h: lin(1, -2 * gap) }, '')
  }
  return { tiles, splits }
}

/*
 * Tile edges are rounded to whole pixels, each edge on its own, so a tile's size is
 * the difference of two rounded edges. Unrounded, a tile at 55% of an odd height
 * starts mid-pixel and everything in it (text, icons, borders) is drawn between
 * pixels: blurry, and in Firefox it hops a pixel whenever the window's layers change.
 * Rounding edges rather than sizes keeps neighbours flush, so gutters stay exact.
 * `resolveRect` and `cssRect` round the same way, so script and CSS agree.
 */

/** A linear rect in pixels, for a desktop of `bounds`. */
export function resolveRect(r: LinRect, bounds: Rect): Rect {
  const at = (l: Lin, length: number) => Math.round(l.p * length + l.px)
  const x = at(r.x, bounds.w)
  const y = at(r.y, bounds.h)
  return {
    x: bounds.x + x,
    y: bounds.y + y,
    w: at(plus(r.x, r.w), bounds.w) - x,
    h: at(plus(r.y, r.h), bounds.h) - y,
  }
}

/** A linear rect as CSS `left`/`top`/`width`/`height`, relative to the desktop. */
export function cssRect(r: LinRect): {
  left: string
  top: string
  width: string
  height: string
} {
  const edge = (l: Lin) => `round(calc(${+(l.p * 100).toFixed(4)}% + ${+l.px.toFixed(3)}px), 1px)`
  const size = (start: Lin, length: Lin) => `calc(${edge(plus(start, length))} - ${edge(start)})`
  return {
    left: edge(r.x),
    top: edge(r.y),
    width: size(r.x, r.w),
    height: size(r.y, r.h),
  }
}

/**
 * The ratio range that keeps both sides of a split at least `minTile` px, for a split
 * whose area is `length` px along its axis.
 */
export function clampRatio(ratio: number, length: number, gap: number, minTile = 160): number {
  const avail = length - gap
  if (avail <= minTile * 2) return 0.5
  const lo = minTile / avail
  return Math.min(1 - lo, Math.max(lo, ratio))
}

/**
 * The split a tiled window's `edge` resizes: the nearest ancestor that divides along
 * that edge with the window on the matching side and something visible opposite.
 * `null` for an outer edge, which has nothing to push against.
 */
export function resizeTargetFor(
  layout: TileLayout,
  tree: TileNode | null,
  id: Id,
  edge: 'n' | 's' | 'e' | 'w',
): SplitLayout | null {
  const path = leafPath(tree, id)
  if (path === null) return null
  const axis: SplitAxis = edge === 'e' || edge === 'w' ? 'row' : 'column'
  // The window must sit on side a for an east/south edge, side b for west/north.
  const side = edge === 'e' || edge === 's' ? 'a' : 'b'
  for (let depth = path.length - 1; depth >= 0; depth--) {
    if (path[depth] !== side) continue
    const split = layout.splits.find((s) => s.path === path.slice(0, depth) && s.axis === axis)
    if (split) return split
  }
  return null
}

function leafPath(tree: TileNode | null, id: Id, path = ''): TilePath | null {
  if (!tree) return null
  if (tree.type === 'leaf') return tree.id === id ? path : null
  return leafPath(tree.a, id, path + 'a') ?? leafPath(tree.b, id, path + 'b')
}

// ---------------------------------------------------------------------------
// Dropping a window into the tiling.

/** At a desktop edge, the share of a tile's length at each end that splits across it. */
const END = 0.25

export interface DropOptions {
  /** How close to a desktop edge the pointer must be to tile there. */
  edge?: number
  /** Anywhere over a tile splits it, not only at the desktop edges (Shift-drag). */
  anywhere?: boolean
}

/**
 * Where a window dropped at `(px, py)` would tile, or `null` to stay floating.
 *
 * At a desktop edge, the tile against that edge is split. Most of the edge (its middle
 * half, along that tile) puts the window on the edge's own side; only the outer
 * quarters at either end put it before or after the tile, across the edge. So the
 * common drop is forgiving, and dropping low on the left edge still splits whatever
 * holds the left edge there, with the new window underneath.
 * With `anywhere`, the tile under the pointer is split toward its nearest edge.
 */
export function dropTargetAt(
  px: number,
  py: number,
  bounds: Rect,
  tiles: ReadonlyMap<Id, Rect>,
  { edge = 32, anywhere = false }: DropOptions = {},
): TileTarget | null {
  const inside = (r: Rect, x: number, y: number) =>
    x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
  const tileAt = (x: number, y: number) => {
    for (const [id, r] of tiles) if (inside(r, x, y)) return { id, r }
    return null
  }

  const sides: [Side, boolean][] = [
    ['left', px <= bounds.x + edge],
    ['right', px >= bounds.x + bounds.w - edge],
    ['top', py <= bounds.y + edge],
    ['bottom', py >= bounds.y + bounds.h - edge],
  ]
  const at = sides.find(([, near]) => near)?.[0]
  if (at) {
    // Look just inside the edge (past the outer gap) for the tile that holds it.
    const reach = edge + 12
    const x = at === 'left' ? bounds.x + reach : at === 'right' ? bounds.x + bounds.w - reach : px
    const y = at === 'top' ? bounds.y + reach : at === 'bottom' ? bounds.y + bounds.h - reach : py
    const hit = tileAt(x, y)
    if (!hit) return { kind: 'edge', side: at }
    const along = axisOf(at) === 'row' ? (py - hit.r.y) / hit.r.h : (px - hit.r.x) / hit.r.w
    const before: Side = axisOf(at) === 'row' ? 'top' : 'left'
    const after: Side = axisOf(at) === 'row' ? 'bottom' : 'right'
    const side = along < END ? before : along > 1 - END ? after : at
    return { kind: 'tile', of: hit.id, side }
  }

  if (!anywhere) return null
  const hit = tileAt(px, py)
  if (!hit) return null
  const dx = (px - (hit.r.x + hit.r.w / 2)) / hit.r.w
  const dy = (py - (hit.r.y + hit.r.h / 2)) / hit.r.h
  const side: Side =
    Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom'
  return { kind: 'tile', of: hit.id, side }
}
