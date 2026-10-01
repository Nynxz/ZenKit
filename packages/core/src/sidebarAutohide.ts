// Auto-hide ComfyUI's left rail and the Graph/App toggle beside it. Both slide off the left
// edge together, by the same distance, and come back when the pointer reaches the edge.
//
// Hover is decided by geometry, not by which element is under the pointer: while shown, the
// pair stays out as long as the pointer is within PAD of where they rest; once it leaves, they
// hide after a grace period. Gaps between the two, or the elements sliding under a still
// pointer, therefore never flicker them. An open sidebar tab, or a menu opened from either of
// them (the ComfyUI logo menu, the Graph/App menu, a rail context menu), keeps them out.
import { ensureStyle, removeStyle } from './dom'

const STYLE_ID = 'zenkit-sidebar-autohide'
const RAIL = '.side-tool-bar-container'
const TOGGLE = '.floating-panel:has(> [data-testid="view-mode-toggle"])'
const EDGE = 16 // px from the left edge that reveals
const TOP = 40 // the edge zone starts below the workflow tabs
const PAD = 28 // px around the shown pair that still counts as over it
const HIDE_DELAY = 380

const CSS = `
.zen-sb-autohide :is(${RAIL}, ${TOGGLE}) {
  transform: translateX(calc(-1 * var(--zen-sb-shift, 260px))); opacity: 0;
  pointer-events: none !important;
  transition: transform .28s cubic-bezier(.4, 0, .2, 1), opacity .22s ease;
}
.zen-sb-autohide.zen-sb-show :is(${RAIL}, ${TOGGLE}) {
  transform: none; opacity: 1; pointer-events: auto !important;
}
.zen-sb-edge { position: fixed; left: 0; top: ${TOP}px; bottom: 0; width: ${EDGE}px; z-index: 1400; pointer-events: none; }
.zen-sb-edge::after {
  content: ''; position: absolute; left: 3px; top: 50%; transform: translateY(-50%);
  width: 4px; height: 44px; border-radius: 4px; background: var(--zen-border, #3a3a44);
  opacity: .45; transition: opacity .2s ease, height .2s ease, background .2s ease;
}
.zen-sb-edge.near::after { opacity: 1; height: 66px; background: var(--zen-accent, #3b82f6); }
.zen-sb-show .zen-sb-edge { opacity: 0; }`

const parts = () =>
  [RAIL, TOGGLE].map((s) => document.querySelector<HTMLElement>(s)).filter((e) => e !== null)
const HOLDS = [
  '.sidebar-content-container',
  `:is(${RAIL}, ${TOGGLE}) [aria-expanded="true"]`,
  '.p-tieredmenu-overlay',
  '[role="menu"][data-state="open"]',
].join(', ')
const held = () => !!document.querySelector(HOLDS)
const body = () => document.body.classList

let stop: (() => void) | null = null

export function setSidebarAutohide(on: boolean): void {
  stop?.()
  stop = on ? start() : null
}

function start(): () => void {
  let homes: DOMRect[] = []
  let hideTimer = 0
  let frame = 0
  let last: PointerEvent | null = null

  // Where the pair rests, measured only while it is fully out (transforms would skew it).
  const measure = () => {
    if (body().contains('zen-sb-autohide') && !body().contains('zen-sb-show')) return
    const rects = parts().map((e) => e.getBoundingClientRect())
    if (!rects.length) return
    homes = rects
    const right = Math.max(...rects.map((r) => r.right))
    document.body.style.setProperty('--zen-sb-shift', `${Math.ceil(right) + 12}px`)
  }
  const show = () => {
    clearTimeout(hideTimer)
    hideTimer = 0
    body().add('zen-sb-show')
  }
  const hideSoon = () => {
    if (hideTimer || !body().contains('zen-sb-show')) return
    const check = () => {
      if (held()) hideTimer = window.setTimeout(check, HIDE_DELAY)
      else {
        hideTimer = 0
        if (!last || !near(last.clientX, last.clientY)) body().remove('zen-sb-show')
      }
    }
    hideTimer = window.setTimeout(check, HIDE_DELAY)
  }
  const near = (x: number, y: number) =>
    homes.some(
      (r) => x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD,
    )

  const edge = document.createElement('div')
  edge.className = 'zen-sb-edge'
  document.body.appendChild(edge)

  const decide = () => {
    frame = 0
    if (!last) return
    const { clientX: x, clientY: y } = last
    const atEdge = x <= EDGE && y >= TOP
    edge.classList.toggle('near', atEdge)
    if (body().contains('zen-sb-show')) {
      if (near(x, y) || atEdge) {
        clearTimeout(hideTimer)
        hideTimer = 0
      } else hideSoon()
    } else if (atEdge) show()
  }
  const onMove = (e: PointerEvent) => {
    last = e
    if (!frame) frame = requestAnimationFrame(decide)
  }
  const onLeave = () => {
    edge.classList.remove('near')
    hideSoon()
  }
  const onSettled = (e: TransitionEvent) => {
    if (e.propertyName === 'transform' && (e.target as Element).matches?.(RAIL)) measure()
  }

  measure()
  ensureStyle(STYLE_ID, CSS)
  body().add('zen-sb-autohide')
  document.addEventListener('pointermove', onMove, { capture: true, passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  document.addEventListener('transitionend', onSettled, true)
  window.addEventListener('resize', measure)
  // A tab ComfyUI restores at load keeps the pair out once it has rendered.
  const restoreCheck = window.setTimeout(() => held() && show(), 1500)

  return () => {
    clearTimeout(hideTimer)
    clearTimeout(restoreCheck)
    cancelAnimationFrame(frame)
    document.removeEventListener('pointermove', onMove, { capture: true })
    document.documentElement.removeEventListener('pointerleave', onLeave)
    document.removeEventListener('transitionend', onSettled, true)
    window.removeEventListener('resize', measure)
    edge.remove()
    body().remove('zen-sb-autohide', 'zen-sb-show')
    document.body.style.removeProperty('--zen-sb-shift')
    removeStyle(STYLE_ID)
  }
}
