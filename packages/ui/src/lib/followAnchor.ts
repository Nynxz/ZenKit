// Keeping a floating panel on the element it opened from. A canvas pan or zoom moves that element
// by a CSS transform, which fires no scroll event, so the anchor's box is read once a frame while
// the panel is open — a handful of numbers, and only while something is showing.
//
// Reading a box makes the browser bring its styles up to date first. While the panel's own list
// scrolls, rows come and go every few frames, and on a page as large as ComfyUI's that update cost
// whole frames — the scroll stalled and caught up in jumps. The graph can't be panned under a list
// being scrolled, so the reads wait until the panel has been still for a moment.

/** How long after a scroll or wheel inside the panel its anchor is read again, ms. */
const SETTLE = 150

/** Call `onMove` whenever the box `rect` reads changes, and `onGone` once it reads nothing (the
 *  anchor left the page). `panel`: the floating element, whose own scrolling pauses the reads.
 *  Returns the function that stops watching. */
export function followAnchor(
  rect: () => DOMRect | null,
  onMove: () => void,
  onGone: () => void,
  panel?: () => Element | null | undefined,
): () => void {
  let last = rect()
  let quietUntil = 0
  const onPanelScroll = (e: Event) => {
    if (e.target instanceof Node && panel?.()?.contains(e.target))
      quietUntil = performance.now() + SETTLE
  }
  if (panel) {
    window.addEventListener('scroll', onPanelScroll, { capture: true, passive: true })
    window.addEventListener('wheel', onPanelScroll, { capture: true, passive: true })
  }
  let frame = requestAnimationFrame(function tick(now) {
    frame = requestAnimationFrame(tick)
    if (now < quietUntil) return
    const box = rect()
    if (!box) {
      stop()
      onGone()
      return
    }
    if (
      !last ||
      box.x !== last.x ||
      box.y !== last.y ||
      box.width !== last.width ||
      box.height !== last.height
    ) {
      last = box
      onMove()
    }
  })
  function stop() {
    cancelAnimationFrame(frame)
    window.removeEventListener('scroll', onPanelScroll, { capture: true })
    window.removeEventListener('wheel', onPanelScroll, { capture: true })
  }
  return stop
}

/** The box of `el` while it's on the page and drawn, else null. */
export function liveRect(el: Element | null | undefined): DOMRect | null {
  if (!el?.isConnected) return null
  const r = el.getBoundingClientRect()
  return r.width || r.height ? r : null
}
