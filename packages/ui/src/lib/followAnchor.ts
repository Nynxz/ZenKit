// Keeping a floating panel on the element it opened from. A canvas pan or zoom moves that element
// by a CSS transform, which fires no scroll event, so the anchor's box is read once a frame while
// the panel is open — a handful of numbers, and only while something is showing.

/** Call `onMove` whenever the box `rect` reads changes, and `onGone` once it reads nothing (the
 *  anchor left the page). Returns the function that stops watching. */
export function followAnchor(
  rect: () => DOMRect | null,
  onMove: () => void,
  onGone: () => void,
): () => void {
  let last = rect()
  let frame = requestAnimationFrame(function tick() {
    const now = rect()
    if (!now) {
      onGone()
      return
    }
    if (
      !last ||
      now.x !== last.x ||
      now.y !== last.y ||
      now.width !== last.width ||
      now.height !== last.height
    ) {
      last = now
      onMove()
    }
    frame = requestAnimationFrame(tick)
  })
  return () => cancelAnimationFrame(frame)
}

/** The box of `el` while it's on the page and drawn, else null. */
export function liveRect(el: Element | null | undefined): DOMRect | null {
  if (!el?.isConnected) return null
  const r = el.getBoundingClientRect()
  return r.width || r.height ? r : null
}
