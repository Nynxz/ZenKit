// Pure binary split-tree layout: leaves hold a panelId, internal nodes split
// 'row'/'col' with a ratio for the divider.

export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

export interface TileNode {
  id: string
  panelId?: string // leaf content (a ZenKit panel id); undefined = empty leaf
  split?: 'row' | 'col'
  ratio?: number // 0..1, size of children[0]
  children?: [TileNode, TileNode]
}

let _seq = 0
export function nodeId(): string {
  return `t${++_seq}`
}

export function leaf(panelId?: string): TileNode {
  return { id: nodeId(), panelId }
}

export function isLeaf(n: TileNode): boolean {
  return !n.split || !n.children
}

export function findNode(n: TileNode | null, id: string): TileNode | null {
  if (!n) return null
  if (n.id === id) return n
  if (!n.children) return null
  return findNode(n.children[0], id) || findNode(n.children[1], id)
}

export function findLeafByPanel(n: TileNode | null, panelId: string): TileNode | null {
  if (!n) return null
  if (isLeaf(n)) return n.panelId === panelId ? n : null
  return findLeafByPanel(n.children![0], panelId) || findLeafByPanel(n.children![1], panelId)
}

export function panelIds(n: TileNode | null): string[] {
  if (!n) return []
  if (isLeaf(n)) return n.panelId ? [n.panelId] : []
  return [...panelIds(n.children![0]), ...panelIds(n.children![1])]
}

export function updateNode(n: TileNode, id: string, fn: (x: TileNode) => TileNode): TileNode {
  if (n.id === id) return fn(n)
  if (!n.children) return n
  const a = updateNode(n.children[0], id, fn)
  const b = updateNode(n.children[1], id, fn)
  if (a === n.children[0] && b === n.children[1]) return n
  return { ...n, children: [a, b] }
}

// Drop empty leaves and lift a split node that has only one surviving child.
export function collapse(n: TileNode | null): TileNode | null {
  if (!n) return null
  if (isLeaf(n)) return n.panelId ? n : null
  const a = collapse(n.children![0])
  const b = collapse(n.children![1])
  if (!a && !b) return null
  if (a && !b) return a
  if (!a && b) return b
  if (a === n.children![0] && b === n.children![1]) return n
  return { ...n, children: [a as TileNode, b as TileNode] }
}

function firstEmptyLeaf(n: TileNode): TileNode | null {
  if (isLeaf(n)) return n.panelId ? null : n
  return firstEmptyLeaf(n.children![0]) || firstEmptyLeaf(n.children![1])
}
function lastFilledLeaf(n: TileNode): TileNode | null {
  if (isLeaf(n)) return n.panelId ? n : null
  return lastFilledLeaf(n.children![1]) || lastFilledLeaf(n.children![0])
}

/** Add a panel: fill first empty leaf, else split the last filled leaf. */
export function place(tree: TileNode | null, panelId: string): TileNode {
  if (!tree) return leaf(panelId)
  const empty = firstEmptyLeaf(tree)
  if (empty) return updateNode(tree, empty.id, (l) => ({ ...l, panelId }))
  const last = lastFilledLeaf(tree)
  if (last) {
    return updateNode(tree, last.id, (existing) => ({
      id: nodeId(),
      split: 'row',
      ratio: 0.5,
      children: [existing, leaf(panelId)],
    }))
  }
  return leaf(panelId)
}

/** Drop a panel onto a target leaf's edge zone → split it (or replace on center). */
export function splitAt(
  tree: TileNode,
  targetId: string,
  zone: DropZone,
  panelId: string,
): TileNode {
  return updateNode(tree, targetId, (target) => {
    if (zone === 'center') return { ...target, panelId }
    const split: 'row' | 'col' = zone === 'left' || zone === 'right' ? 'row' : 'col'
    const fresh = leaf(panelId)
    const children: [TileNode, TileNode] =
      zone === 'left' || zone === 'top' ? [fresh, { ...target }] : [{ ...target }, fresh]
    return { id: nodeId(), split, ratio: 0.5, children }
  })
}

/** Remove a panel from the tree (clear its leaf), collapsing empty structure. */
export function removePanel(tree: TileNode | null, panelId: string): TileNode | null {
  if (!tree) return null
  const target = findLeafByPanel(tree, panelId)
  if (!target) return tree
  const cleared = updateNode(tree, target.id, (l) => ({ ...l, panelId: undefined }))
  return collapse(cleared)
}

export function setRatio(tree: TileNode, splitId: string, ratio: number): TileNode {
  const r = Math.max(0.1, Math.min(0.9, ratio))
  return updateNode(tree, splitId, (n) => ({ ...n, ratio: r }))
}

/** Which edge zone a pointer at (x,y) within a rect maps to (center if interior). */
export function dropZone(
  rect: { width: number; height: number },
  x: number,
  y: number,
  threshold = 0.25,
): DropZone {
  const w = Math.max(rect.width, 1)
  const h = Math.max(rect.height, 1)
  const dTop = y
  const dBottom = h - y
  const dLeft = x
  const dRight = w - x
  const edge = Math.max(40, Math.min(w, h) * threshold)
  const min = Math.min(dTop, dBottom, dLeft, dRight)
  if (min > edge) return 'center'
  if (dTop <= dBottom && dTop <= dLeft && dTop <= dRight) return 'top'
  if (dBottom <= dLeft && dBottom <= dRight) return 'bottom'
  if (dLeft <= dRight) return 'left'
  return 'right'
}
