// Edge band → which dock side a dragged panel drops into. Top edge excluded (maximize snap).

import type { DockSidePos } from './panelStore'

const EDGE = 30 // px band along each edge that counts as a dock drop

export function dockDropFor(px: number, py: number): DockSidePos | null {
  const W = window.innerWidth
  const H = window.innerHeight
  // Side edges win over the bottom edge so a bottom corner docks to the side.
  if (px <= EDGE) return 'left'
  if (px >= W - EDGE) return 'right'
  if (py >= H - EDGE) return 'bottom'
  return null
}
