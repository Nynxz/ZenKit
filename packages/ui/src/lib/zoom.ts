// CSS `zoom` on the page (an app's UI-size setting) draws everything bigger, but leaves the numbers
// in two spaces: getBoundingClientRect, a pointer's clientX/Y and innerWidth/Height are screen
// pixels, while offsetWidth, scrollTop and the px a style is given are the element's own CSS
// pixels. Code that measures in one and writes in the other converts through these.

/** The CSS zoom `el` is drawn at; by default the page's, which is what a panel teleported to
 *  <body> gets. 1 without zoom. */
export function zoomOf(el: Element | null | undefined = document.body): number {
  if (!el) return 1
  if (typeof el.currentCSSZoom === 'number') return el.currentCSSZoom || 1
  // an engine that can't say: its box on screen against its own width
  const w = el instanceof HTMLElement ? el.offsetWidth : 0
  return (w && el.getBoundingClientRect().width / w) || 1
}

/** A box measured on screen, in the CSS px of something drawn at zoom `z`. */
export function cssRect(r: DOMRect, z: number): DOMRect {
  return z === 1 ? r : new DOMRect(r.x / z, r.y / z, r.width / z, r.height / z)
}

/** The window's size in the CSS px of something drawn at zoom `z`. */
export function cssViewport(z: number): { width: number; height: number } {
  return { width: window.innerWidth / z, height: window.innerHeight / z }
}
