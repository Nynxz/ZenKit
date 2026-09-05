// Tiling state: split-tree + tile entries + drag state.

import { reactive } from 'vue'
import * as T from './tiling/treeModel'

export interface TileEntry {
  panelId: string
  title: string
  icon: string
  render: (el: HTMLElement) => void | (() => void)
}

export const tileStore = reactive({
  tree: null as T.TileNode | null,
  entries: {} as Record<string, TileEntry>,
  dragId: null as string | null, // panelId currently being dragged between tiles
  dragOver: null as { leafId: string; zone: T.DropZone } | null,
})

let opener: (() => void) | null = null
export function setTileOpener(fn: () => void) {
  opener = fn
}

/** Send a panel's content into the tiling area (and open the Tile Area). */
export function tileAddFromPanel(p: {
  id: string
  title: string
  icon: string
  render: TileEntry['render']
}): boolean {
  if (!p.render) return false
  if (!tileStore.entries[p.id]) {
    tileStore.entries[p.id] = {
      panelId: p.id,
      title: p.title,
      icon: p.icon || 'mdi mdi-application-outline',
      render: p.render,
    }
  }
  if (!T.panelIds(tileStore.tree).includes(p.id)) {
    tileStore.tree = T.place(tileStore.tree, p.id)
  }
  opener?.()
  return true
}

/** Is this panel currently living in the tiling area? (so we don't also float it) */
export function isTiled(id: string): boolean {
  return !!tileStore.entries[id] && T.panelIds(tileStore.tree).includes(id)
}

/** Bring the Tile Area to the front (used when opening an already-tiled panel). */
export function focusTiles() {
  opener?.()
}

export function tileRemove(panelId: string) {
  tileStore.tree = T.removePanel(tileStore.tree, panelId)
  delete tileStore.entries[panelId]
}

/** Move a tile onto another leaf's edge zone (drag-to-split). */
export function tileMove(panelId: string, targetLeafId: string, zone: T.DropZone) {
  const tree = tileStore.tree
  if (!tree || zone === 'center') return
  const src = T.findLeafByPanel(tree, panelId)
  if (!src || src.id === targetLeafId) return
  const cleared = T.updateNode(tree, src.id, (l) => ({ ...l, panelId: undefined }))
  const split = T.splitAt(cleared, targetLeafId, zone, panelId)
  tileStore.tree = T.collapse(split)
}

export function tileSetRatio(splitId: string, ratio: number) {
  if (tileStore.tree) tileStore.tree = T.setRatio(tileStore.tree, splitId, ratio)
}

export function tileCount(): number {
  return T.panelIds(tileStore.tree).length
}
