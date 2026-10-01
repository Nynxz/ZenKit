// Where a dragged panel would land. The left edge and ComfyUI's own sidebar rail pin it into
// that sidebar (a native tab, with ComfyUI's paneled look); the right edge docks it to ZenKit's
// right dock; the taskbar and bottom edge dock it to the bottom, where the taskbar is the tab
// strip. Top edge excluded (maximize snap).

import type { DockSidePos } from './panelStore'

export type DockDrop = Exclude<DockSidePos, 'left'> | 'sidebar'

const EDGE = 30 // px band along each edge that counts as a dock drop

function hit(el: Element | null | undefined, px: number, py: number): boolean {
  const r = el?.getBoundingClientRect()
  return !!r && r.width > 0 && px >= r.left && px <= r.right && py >= r.top && py <= r.bottom
}

/** ComfyUI's sidebar icon rail in the visible mode, if it is showing. */
export function sidebarRail(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('.side-tool-bar-container')).find(
      (el) => el.getBoundingClientRect().width > 0,
    ) ?? null
  )
}

export function dockDropFor(px: number, py: number, sidebarAvailable: boolean): DockDrop | null {
  const W = window.innerWidth
  const H = window.innerHeight
  // Side edges win over the bottom edge so a bottom corner docks to the side.
  if (sidebarAvailable && (px <= EDGE || hit(sidebarRail(), px, py))) return 'sidebar'
  if (px >= W - EDGE) return 'right'
  if (py >= H - EDGE || hit(document.querySelector('#zenkit-host .tb'), px, py)) return 'bottom'
  return null
}
