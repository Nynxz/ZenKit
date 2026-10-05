// Floating layers (popovers, select menus, pickers, modals, windows) render outside their parent,
// so a menu opened from inside a popover isn't inside it in the DOM. Each layer's root carries
// LAYER_ATTR so an outer layer can tell a click in a nested one from a click outside, and open
// layers stack so Escape closes only the innermost.

export const LAYER_ATTR = 'data-zen-layer'

/**
 * Shared z-index floors, back to front. Everything sits above ComfyUI's own dialogs/menus (core
 * pins those at 2000), core's panel host (1500), taskbar (99999) and fullscreen host (100000).
 * A floor is only a minimum: `openLayer` lifts a layer above whatever is already open, so a
 * dropdown opened from inside a window/modal/lightbox always renders over it.
 */
export const Z = {
  /** dropdowns, menus, pickers, context menus, popovers */
  popover: 100000,
  modal: 100100,
  window: 100200,
  lightbox: 100300,
  /** hover previews — above everything static */
  peek: 100400,
} as const

/** True when the event target is inside any floating layer other than `own`. */
export function inOtherLayer(target: EventTarget | null, own: Element | null | undefined): boolean {
  const layer = target instanceof Element ? target.closest(`[${LAYER_ATTR}]`) : null
  return !!layer && layer !== own
}

export interface Layer {
  /** The z-index to render at: `floor`, or just above the topmost open layer. */
  z: number
  isTop(): boolean
  /** True when `e` is an Escape for this layer: it is the innermost and no layer has already
   *  taken this keypress (one that closed and released synchronously can't pass it down). */
  escape(e: KeyboardEvent): boolean
  release(): void
}

const stack: { id: symbol; z: number }[] = []
const taken = new WeakSet<Event>()

/** The z-index a layer opened now would get (for layers that don't join the Escape stack). */
export function zAbove(floor: number = Z.popover): number {
  return stack.reduce((z, l) => Math.max(z, l.z + 1), floor)
}

/** Register an open layer; `isTop` says whether it is the innermost, `release` when it closes. */
export function openLayer(floor: number = Z.popover): Layer {
  const id = Symbol('layer')
  const z = zAbove(floor)
  stack.push({ id, z })
  const isTop = () => stack.at(-1)?.id === id
  return {
    z,
    isTop,
    escape: (e) => {
      if (e.key !== 'Escape' || taken.has(e) || !isTop()) return false
      taken.add(e)
      return true
    },
    release: () => {
      const i = stack.findIndex((l) => l.id === id)
      if (i !== -1) stack.splice(i, 1)
    },
  }
}
