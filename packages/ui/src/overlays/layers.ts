// Floating layers (popovers, select menus, pickers, modals, windows) render outside their parent,
// so a menu opened from inside a popover isn't inside it in the DOM. Each layer's root carries
// LAYER_ATTR so an outer layer can tell a click in a nested one from a click outside, and open
// layers stack so Escape closes only the innermost.

export const LAYER_ATTR = 'data-zen-layer'

/** True when the event target is inside any floating layer other than `own`. */
export function inOtherLayer(target: EventTarget | null, own: Element | null | undefined): boolean {
  const layer = target instanceof Element ? target.closest(`[${LAYER_ATTR}]`) : null
  return !!layer && layer !== own
}

const stack: symbol[] = []

/** Register an open layer; `isTop` says whether it is the innermost, `release` when it closes. */
export function openLayer(): { isTop(): boolean; release(): void } {
  const id = Symbol('layer')
  stack.push(id)
  return {
    isTop: () => stack.at(-1) === id,
    release: () => {
      const i = stack.indexOf(id)
      if (i !== -1) stack.splice(i, 1)
    },
  }
}
