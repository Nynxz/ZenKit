// Click-to-focus for a node body that wants the wheel (a picture you zoom, a list you scroll).
//
// ComfyUI's canvas takes wheel events from a capture listener on an ancestor. Its only opt-out
// yields when the wheel is over a `data-capture-wheel` element AND focus is inside that same
// element. Focusing on pointerenter satisfies it but steals scrolling on hover, so this focuses
// on the press instead — click in and the surface is yours, click out or Escape and it isn't.
//
// The focus ring is the consumer's; `focused` is the whole API.
//
//     const focus = useFocusSurface({ canFocus: () => !!image.value })
//     <div :ref="(el) => (focus.el.value = el as HTMLElement | null)"
//          v-bind="focus.attrs"
//          :class="{ focused: focus.focused.value }"
//          @wheel.prevent="onWheel" />

import { onScopeDispose, ref, watch, type Ref } from 'vue'

export interface FocusSurfaceOptions {
  /** Return false to ignore a press — e.g. there's nothing to zoom yet, so the wheel should
   *  stay with the canvas rather than being captured by an empty surface. */
  canFocus?: () => boolean
  onFocus?: () => void
  onBlur?: () => void
}

export interface FocusSurface {
  /** Bind to the surface element. */
  el: Ref<HTMLElement | null>
  /** True while focus is inside the surface — style the ring off this. */
  focused: Ref<boolean>
  /** Spread onto the surface: makes it focusable and marks it as a wheel target. */
  attrs: { tabindex: string; 'data-capture-wheel': string }
  focus: () => void
  blur: () => void
}

/** Fields own their own keystrokes: never yank focus out of one mid-edit. */
function isTyping(el: Element | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
}

export function useFocusSurface(opts: FocusSurfaceOptions = {}): FocusSurface {
  const el = ref<HTMLElement | null>(null)
  const focused = ref(false)

  function setFocused(next: boolean): void {
    if (focused.value === next) return
    focused.value = next
    if (next) opts.onFocus?.()
    else opts.onBlur?.()
  }

  function focus(): void {
    const node = el.value
    if (!node) return
    if (node.contains(document.activeElement)) return // already ours, or a control inside has it
    node.focus({ preventScroll: true })
  }
  function blur(): void {
    const node = el.value
    if (!node) return
    // Blur whatever inside actually holds focus, not just the surface itself.
    const active = document.activeElement as HTMLElement | null
    if (active && node.contains(active)) active.blur()
    setFocused(false)
  }

  // A press anywhere in the surface claims it — including on a control inside, which takes
  // focus itself and still satisfies the canvas's `contains(activeElement)` test.
  function onPointerdown(): void {
    if (opts.canFocus?.() === false) return
    if (isTyping(document.activeElement)) return
    focus()
  }
  const onFocusin = () => setFocused(true)
  function onFocusout(e: FocusEvent): void {
    const node = el.value
    const next = e.relatedTarget as Node | null
    if (node && next && node.contains(next)) return // moved between controls inside — still ours
    setFocused(false)
  }

  // Clicking the canvas doesn't always move focus (LiteGraph may leave activeElement alone), so
  // focusout can't be the only way out. Capture phase: this must run whatever the press hits.
  function onDocPointerdown(e: PointerEvent): void {
    const node = el.value
    if (!node || !focused.value) return
    const target = e.target as Node | null
    if (target && node.contains(target)) return
    blur()
  }
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && focused.value) blur()
  }

  function attach(node: HTMLElement): void {
    node.addEventListener('pointerdown', onPointerdown)
    node.addEventListener('focusin', onFocusin)
    node.addEventListener('focusout', onFocusout)
  }
  function detach(node: HTMLElement): void {
    node.removeEventListener('pointerdown', onPointerdown)
    node.removeEventListener('focusin', onFocusin)
    node.removeEventListener('focusout', onFocusout)
  }

  watch(el, (node, prev) => {
    if (prev) detach(prev)
    if (node) attach(node)
    else setFocused(false)
  })

  document.addEventListener('pointerdown', onDocPointerdown, true)
  document.addEventListener('keydown', onKeydown)
  onScopeDispose(() => {
    document.removeEventListener('pointerdown', onDocPointerdown, true)
    document.removeEventListener('keydown', onKeydown)
    if (el.value) detach(el.value)
  })

  return {
    el,
    focused,
    attrs: { tabindex: '-1', 'data-capture-wheel': 'true' },
    focus,
    blur,
  }
}
