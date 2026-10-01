// Where the agent's nodes go. The model is poor at choosing coordinates, so it doesn't: a node it
// adds is placed beside the node it gets wired to (left of what it feeds, right of what feeds
// it), lined up with that slot, and moved down past anything it would cover. The user's own
// nodes are never moved, except by tidy(), which the user asks for.

export interface LayoutNode {
  id: number
  pos: [number, number]
  size: [number, number]
  /** What is actually drawn: `size`, grown to fit content such as an image preview. */
  renderingSize?: [number, number]
  inputs?: { link?: number | null }[]
  outputs?: { links?: number[] | null }[]
}

export interface LayoutGraph {
  nodes(): LayoutNode[]
  byId(id: number): LayoutNode | null
  link(id: number): { origin_id: number; origin_slot: number; target_id: number; target_slot: number } | undefined
}

const LG = () => (window as unknown as { LiteGraph?: { NODE_TITLE_HEIGHT?: number; NODE_SLOT_HEIGHT?: number } }).LiteGraph
const titleHeight = () => LG()?.NODE_TITLE_HEIGHT ?? 30
const slotHeight = () => LG()?.NODE_SLOT_HEIGHT ?? 20
const GAP_X = 80
const GAP_Y = 30

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The node's drawn width and height (below its title bar). */
export const sizeOf = (node: LayoutNode): [number, number] => {
  const [w, h] = node.renderingSize ?? node.size
  return [Math.max(w, node.size[0]), Math.max(h, node.size[1])]
}

/** A node's whole box as drawn, its title bar (above `pos`) included. */
export function boxOf(node: LayoutNode): Box {
  const [w, h] = sizeOf(node)
  return { x: node.pos[0], y: node.pos[1] - titleHeight(), w, h: h + titleHeight() }
}

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

/** Put the node at the free spot nearest `ideal` (its pos), keeping it within [minX, maxX] so wires
 *  still run left to right. Tried: the ideal spot, just above or below every other node, and
 *  lined up with the left or right edge of every column already there. */
function placeNear(node: LayoutNode, ideal: [number, number], g: LayoutGraph, ignore: Set<number>, minX = -Infinity, maxX = Infinity): void {
  const others = g
    .nodes()
    .filter((o) => o.id !== node.id && !ignore.has(o.id))
    .map(boxOf)
  const t = titleHeight()
  const [w, inner] = sizeOf(node)
  const h = inner + t
  const fits = (x: number, y: number) => !others.some((b) => overlaps({ x, y: y - t, w, h }, b, GAP_Y))
  const xs = [ideal[0], ...others.flatMap((b) => [b.x, b.x + b.w - w])].filter((x) => x >= minX && x <= maxX)
  const ys = [ideal[1], ...others.flatMap((b) => [b.y + b.h + GAP_Y + t, b.y - h - GAP_Y + t])]
  let best: [number, number] = ideal
  let cost = Infinity
  for (const x of xs)
    for (const y of ys) {
      const c = Math.abs(x - ideal[0]) + Math.abs(y - ideal[1])
      if (c < cost && fits(x, y)) [best, cost] = [[x, y], c]
    }
  if (cost === Infinity) {
    const bottom = Math.max(...others.map((b) => b.y + b.h))
    best = [ideal[0], bottom + GAP_Y + t]
  }
  node.pos = best
}

/** Neighbours a node is wired to: the nodes it feeds and the nodes feeding it, with the slots. */
function wiring(node: LayoutNode, g: LayoutGraph) {
  const feeds: { node: LayoutNode; outSlot: number; inSlot: number }[] = []
  const fedBy: { node: LayoutNode; outSlot: number; inSlot: number }[] = []
  node.outputs?.forEach((out, outSlot) => {
    for (const id of out.links ?? []) {
      const l = g.link(id)
      const target = l && g.byId(l.target_id)
      if (target) feeds.push({ node: target, outSlot, inSlot: l.target_slot })
    }
  })
  node.inputs?.forEach((input, inSlot) => {
    const l = input.link != null ? g.link(input.link) : undefined
    const source = l && g.byId(l.origin_id)
    if (source) fedBy.push({ node: source, outSlot: l.origin_slot, inSlot })
  })
  return { feeds, fedBy }
}

/** Nodes added by the agent that haven't found their place yet (no wire to a placed node). */
const waiting = new Set<number>()

/** A new node's first spot, before it is wired: under everything, at the left edge. */
export function parkNew(node: LayoutNode, g: LayoutGraph): void {
  const others = g.nodes().filter((n) => n.id !== node.id && !waiting.has(n.id)).map(boxOf)
  const left = others.length ? Math.min(...others.map((b) => b.x)) : 0
  const bottom = others.length ? Math.max(...others.map((b) => b.y + b.h)) : 0
  placeNear(node, [left, bottom + GAP_Y * 2 + titleHeight()], g, new Set())
  waiting.add(node.id)
}

/** The node is placed by hand (the model moved it): leave it be from now on. */
export const pin = (id: number) => waiting.delete(id)
export const forget = pin

/** Place the agent's new nodes, once its reply is done and the wiring is known. Working out from
 *  the nodes already placed: a new node feeding a placed one goes to its left, lined up with the
 *  input; then whatever feeds that goes left of it, and so on. Nodes that only take from placed
 *  ones go to their right. New nodes wired to nothing stay where they were parked. */
export function settleAll(g: LayoutGraph): number {
  let placed = 0
  for (let progress = true; progress && waiting.size; ) {
    progress = false
    for (const side of ['consumer', 'producer'] as const) {
      for (const id of [...waiting]) {
        const node = g.byId(id)
        if (!node) {
          waiting.delete(id)
          continue
        }
        const { feeds, fedBy } = wiring(node, g)
        const anchor = side === 'consumer' ? feeds.find((f) => !waiting.has(f.node.id)) : fedBy.find((f) => !waiting.has(f.node.id))
        if (!anchor) continue
        waiting.delete(id)
        const a = anchor.node
        if (side === 'consumer') {
          const y = a.pos[1] + (anchor.inSlot - anchor.outSlot) * slotHeight()
          placeNear(node, [a.pos[0] - sizeOf(node)[0] - GAP_X, y], g, waiting, -Infinity, a.pos[0] - sizeOf(node)[0] - GAP_X / 2)
        } else {
          const y = a.pos[1] + (anchor.outSlot - anchor.inSlot) * slotHeight()
          placeNear(node, [a.pos[0] + sizeOf(a)[0] + GAP_X, y], g, waiting, a.pos[0] + sizeOf(a)[0] + GAP_X / 2)
        }
        placed++
        progress = true
      }
      if (progress) break
    }
  }
  return placed
}

/** Lay the nodes out in columns by data flow: sources on the left, each node one column right of
 *  its furthest input, columns ordered to keep wires short. Starts where the graph starts. */
export function tidy(g: LayoutGraph, only?: Set<number>): number {
  const all = g.nodes().filter((n) => !only || only.has(n.id))
  if (!all.length) return 0
  const inSet = new Set(all.map((n) => n.id))
  const rank = new Map<number, number>()
  const visiting = new Set<number>()
  const rankOf = (node: LayoutNode): number => {
    const known = rank.get(node.id)
    if (known !== undefined) return known
    if (visiting.has(node.id)) return 0
    visiting.add(node.id)
    const sources = wiring(node, g).fedBy.filter((f) => inSet.has(f.node.id))
    const r = sources.length ? Math.max(...sources.map((f) => rankOf(f.node) + 1)) : 0
    visiting.delete(node.id)
    rank.set(node.id, r)
    return r
  }
  all.forEach(rankOf)

  // Sources with nothing upstream sit one column left of what they feed, not all at column 0.
  for (const node of all) {
    const { feeds, fedBy } = wiring(node, g)
    const consumers = feeds.filter((f) => inSet.has(f.node.id))
    if (!fedBy.some((f) => inSet.has(f.node.id)) && consumers.length)
      rank.set(node.id, Math.min(...consumers.map((f) => rank.get(f.node.id)!)) - 1)
  }

  const columns: LayoutNode[][] = []
  for (const node of all) (columns[rank.get(node.id)!] ??= []).push(node)
  const order = new Map<number, number>()
  const index = (list: LayoutNode[]) => list.forEach((n, i) => order.set(n.id, i))
  const filled = columns.filter(Boolean)
  for (const column of filled) column.sort((a, b) => a.pos[1] - b.pos[1])
  filled.forEach(index)
  // Two sweeps: order each column by where its inputs sit, then by where its outputs go.
  const mean = (xs: number[], fallback: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback)
  for (const pass of ['fedBy', 'feeds'] as const) {
    const sweep = pass === 'fedBy' ? filled : [...filled].reverse()
    // Where a node's neighbours sit, plus which of their slots it uses, so nodes feeding the same
    // node stack in that node's input order (model, positive, negative, latent…).
    const weight = (n: LayoutNode) =>
      mean(
        wiring(n, g)
          [pass].filter((f) => inSet.has(f.node.id))
          .map((f) => order.get(f.node.id)! + (pass === 'feeds' ? f.inSlot : f.outSlot) / 100),
        order.get(n.id)!,
      )
    for (const column of sweep) {
      column.sort((a, b) => weight(a) - weight(b))
      index(column)
    }
  }

  const left = Math.min(...all.map((n) => n.pos[0]))
  const top = Math.min(...all.map((n) => boxOf(n).y)) + titleHeight()
  let x = left
  for (const column of filled) {
    let y = top
    for (const node of column) {
      node.pos = [x, y]
      y += sizeOf(node)[1] + titleHeight() + GAP_Y
    }
    x += Math.max(...column.map((n) => sizeOf(n)[0])) + GAP_X
  }
  for (const node of all) waiting.delete(node.id)
  return all.length
}

/** Nodes the agent added that are still wired to nothing. */
export const unplaced = () => [...waiting]

/** Move any of these nodes that now covers another (a preview that loaded after it was placed
 *  makes a node taller) to the nearest free spot. Returns how many moved. */
export function resolveOverlaps(ids: Iterable<number>, g: LayoutGraph): number {
  let moved = 0
  for (const id of ids) {
    const node = g.byId(id)
    if (!node) continue
    const me = boxOf(node)
    if (!g.nodes().some((o) => o.id !== id && overlaps(me, boxOf(o), 0))) continue
    placeNear(node, [node.pos[0], node.pos[1]], g, new Set())
    moved++
  }
  return moved
}
