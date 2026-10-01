// Pulling a docked panel back out: press on its dock tab (a rail tab, its icon in the taskbar, or
// the title bar of a panel pinned in ComfyUI's sidebar) and drag. Past a small threshold the panel undocks into a floating window under the pointer and
// follows it, previewing the same drop targets as any panel drag. A press that never moves is a
// click on the tab.
import { dockDropFor } from './dockDrop'
import { snapZoneFor, type PanelStore } from './panelStore'

const DRAG_OUT = 14 // px before a press on a dock tab becomes an undock

function beginInteract(store: PanelStore, cursor: string) {
  document.body.style.userSelect = 'none'
  document.body.style.cursor = cursor
  store._ops.setInteract(true, cursor)
}

function endInteract(store: PanelStore) {
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  store._ops.setInteract(false)
}

/** While `active` holds for the pointer, the panel stays docked (e.g. a rail icon dragged within
 *  its rail to reorder it); `release` gets the pointer if the drag ends there. */
export interface DockDragHold {
  active(x: number, y: number): boolean
  move?(x: number, y: number): void
  release?(x: number, y: number): void
  end?(): void
}

export function startDockTabDrag(
  e: PointerEvent,
  store: PanelStore,
  id: string,
  onClick: () => void,
  hold?: DockDragHold,
) {
  if (e.button !== 0) return
  e.preventDefault()
  const ops = store._ops
  const sx = e.clientX
  const sy = e.clientY
  let dragging = false
  let held = false
  let off = { x: 0, y: 0 }
  const onMove = (mv: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(mv.clientX - sx, mv.clientY - sy) < DRAG_OUT) return
      if (hold?.active(mv.clientX, mv.clientY)) {
        held = true
        hold.move?.(mv.clientX, mv.clientY)
        return
      }
      held = false
      hold?.end?.()
      dragging = true
      if (ops.get(id)?.inSidebar) ops.unpinSidebar(id)
      else ops.setDock(id, null)
      const p = ops.get(id)
      if (!p) return
      off = { x: Math.min(p.w / 2, mv.clientX), y: 14 }
      beginInteract(store, 'grabbing')
    }
    ops.setRect(id, { x: mv.clientX - off.x, y: mv.clientY - off.y })
    const drop = dockDropFor(mv.clientX, mv.clientY, store.state.sidebarAvailable)
    store.state.dockDrop = drop
    store.state.snap = drop ? null : snapZoneFor(mv.clientX, mv.clientY)
  }
  const onUp = (up: PointerEvent) => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    if (held) {
      hold?.end?.()
      hold?.release?.(up.clientX, up.clientY)
      return
    }
    if (!dragging) {
      onClick()
      return
    }
    if (store.state.dockDrop) ops.dropInto(id, store.state.dockDrop)
    else if (store.state.snap) ops.applySnap(id, store.state.snap)
    store.state.dockDrop = null
    store.state.snap = null
    ops.setRect(id, {}, true)
    endInteract(store)
  }
  // Capture phase: the graph canvas stops pointer events from bubbling, so a drag released
  // or moved over it would otherwise never reach these.
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
}
