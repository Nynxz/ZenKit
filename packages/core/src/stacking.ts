import { ref } from 'vue'
import type { ZenBus } from './bus'
import { sidebarRail } from './dockDrop'

// ZenKit's panels and ComfyUI's chrome (its sidebar, side panels, top row and bottom panel, all
// one overlay) take turns in front: whichever was used last. The graph itself takes no turn, so
// panning the canvas leaves things as they are.

/** What is in front right now. */
export const inFront = ref<'panels' | 'chrome'>('chrome')

const CHROME_Z = '999'
/** ComfyUI's chrome overlay: the z-999 ancestor of its sidebar rail or canvas panel. */
function chromeOverlay(): Element | null {
  const start = sidebarRail() ?? document.querySelector('.graph-canvas-panel')
  for (let el = start; el && el !== document.body; el = el.parentElement)
    if (getComputedStyle(el).zIndex === CHROME_Z) return el
  return null
}

// What ComfyUI mounts when one of its panels opens, by a click or a keyboard shortcut: a sidebar
// tab's content, the bottom panel, the properties panel.
const OPENED = '.sidebar-content-container > *, .bottom-panel, [data-testid="properties-panel"]'

let overlay: Element | null = null
const liveOverlay = () => (overlay?.isConnected ? overlay : (overlay = chromeOverlay()))

/** Watch presses, panels opening or taking focus, and ComfyUI's own panels opening; returns a
 *  stop. A panel
 *  pinned into ComfyUI's sidebar (`inSidebar`) is chrome when it opens or takes focus. */
export function trackFront(bus: ZenBus, inSidebar: (id: string) => boolean): () => void {
  const onPress = (e: PointerEvent) => {
    const t = e.target as Element | null
    if (!t?.closest) return
    if (t.closest('.zen-panels')) inFront.value = 'panels'
    else if (!t.closest('.graph-canvas-panel') && liveOverlay()?.contains(t))
      inFront.value = 'chrome'
  }
  window.addEventListener('pointerdown', onPress, true)
  const toPanels = (payload: unknown) => {
    const id = (payload as { id?: string } | undefined)?.id
    inFront.value = id && inSidebar(id) ? 'chrome' : 'panels'
  }
  const offFocus = bus.on('panel:focus', toPanels)
  const offOpen = bus.on('panel:open', toPanels)
  // ZenKit's sidebar auto-hide brings ComfyUI's sidebar out by a body class.
  let shown = document.body.classList.contains('zen-sb-show')
  const sidebarOut = new MutationObserver(() => {
    const now = document.body.classList.contains('zen-sb-show')
    if (now && !shown) inFront.value = 'chrome'
    shown = now
  })
  sidebarOut.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  const chromeOpened = new MutationObserver((records) => {
    const root = liveOverlay()
    if (!root) return
    for (const r of records)
      for (const n of r.addedNodes)
        if (
          n instanceof Element &&
          root.contains(n) &&
          (n.matches(OPENED) || n.querySelector(OPENED))
        ) {
          inFront.value = 'chrome'
          return
        }
  })
  chromeOpened.observe(document.body, { childList: true, subtree: true })
  return () => {
    chromeOpened.disconnect()
    window.removeEventListener('pointerdown', onPress, true)
    offFocus()
    offOpen()
    sidebarOut.disconnect()
  }
}
