// The wheel for a node body that scrolls in places — a side panel, a list, a text box — decided per
// event: if something under the pointer scrolls in the wheel's direction, the wheel is the
// node's; anywhere else it goes on to the graph, to zoom or pan as usual.
//
// ComfyUI's canvas takes wheel events from a capture listener on an ancestor and yields only when
// the event is over a `data-capture-wheel="true"` element AND focus is inside that element. So
// this does two things:
//
//   * focus on hover — the body takes focus when the pointer enters (never out of a text field
//     somewhere else) and gives it back when the pointer leaves. That also makes the body's
//     keyboard shortcuts work without a click first.
//   * claim per event — a window capture listener runs before the canvas's and sets the
//     attribute for THIS wheel, from what is under the pointer.
//
// (useFocusSurface is the other policy: click to take the wheel, for a surface that uses the
// wheel itself rather than scrolling.)
//
//     const wheel = useWheelClaim({ ours: (e, target) => !!target.closest('.zoomable') })
//     <div :ref="(el) => (wheel.el.value = el as HTMLElement | null)" v-bind="wheel.attrs" />

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export interface WheelClaimOptions {
  /** Also claim a wheel the scroll test wouldn't — a control that uses the wheel itself. */
  ours?: (e: WheelEvent, target: Element) => boolean
  /** What takes focus on hover. Defaults to the root; return an element inside it (a canvas
   *  with its own keys) to send keystrokes there. */
  focusTarget?: () => HTMLElement | null
}

export interface WheelClaim {
  el: Ref<HTMLElement | null>
  /** Spread onto the root: focusable, and marked as a wheel target. */
  attrs: {
    tabindex: string
    'data-capture-wheel': string
    onPointerenter: () => void
    onPointerleave: () => void
  }
}

function isTyping(el: Element | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
}

/** Whether something between `target` and `root` scrolls in this wheel's direction. */
export function scrollsUnder(e: WheelEvent, target: Element, root: Element): boolean {
  const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)
  const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll'
  for (let el: Element | null = target; el && el !== root.parentElement; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (
      sideways
        ? scrolls(style.overflowX) && el.scrollWidth > el.clientWidth + 1
        : scrolls(style.overflowY) && el.scrollHeight > el.clientHeight + 1
    )
      return true
    if (el === root) break
  }
  return false
}

export function useWheelClaim(opts: WheelClaimOptions = {}): WheelClaim {
  const el = ref<HTMLElement | null>(null)

  function claim(e: WheelEvent): void {
    const root = el.value
    const target = e.target
    if (!root || !(target instanceof Element) || !root.contains(target)) return
    const mine = scrollsUnder(e, target, root) || !!opts.ours?.(e, target)
    root.dataset.captureWheel = String(mine)
  }

  function onPointerenter(): void {
    const root = el.value
    const active = document.activeElement
    if (!root || isTyping(active) || root.contains(active)) return
    const target = opts.focusTarget?.() ?? root
    target.focus({ preventScroll: true })
  }
  function onPointerleave(): void {
    const root = el.value
    const active = document.activeElement as HTMLElement | null
    // Only the focus hovering took: a field the user clicked into keeps it.
    if (root && active && root.contains(active) && !isTyping(active)) active.blur()
  }

  onMounted(() => window.addEventListener('wheel', claim, { capture: true, passive: true }))
  onBeforeUnmount(() => window.removeEventListener('wheel', claim, { capture: true }))

  return {
    el,
    attrs: {
      tabindex: '-1',
      'data-capture-wheel': 'false',
      onPointerenter,
      onPointerleave,
    },
  }
}
