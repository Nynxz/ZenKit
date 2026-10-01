// Drag-to-reorder for the taskbar's window buttons, with the same feel as ComfyUI's workflow
// tabs: the whole strip is one drop target, a thin insertion line follows the pointer (so it
// never flickers between per-button targets), and the neighbours slide into their new places.
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

const DRAG_THRESHOLD = 4 // px of travel before a press becomes a drag, so clicks still click
const GAP_CENTER = 2 // the end lines sit in the gap beside the first/last button, not on it
const SLIDE = { duration: 180, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function useTaskReorder(
  strip: Ref<HTMLElement | null>,
  ids: () => string[],
  reorder: (id: string, beforeId: string | null) => void,
) {
  /** The insertion line's x within the strip, or null when a drop would not move anything. */
  const dropLine = ref<number | null>(null)
  const draggingId = ref<string | null>(null)
  let press: { id: string; x: number } | null = null
  let beforeId: string | null = null
  let swallowClick = false

  const buttons = () =>
    Array.from(strip.value?.querySelectorAll<HTMLElement>('[data-task-id]') ?? [])

  function measure(clientX: number) {
    const el = strip.value
    const all = buttons()
    const shown = all.filter((b) => !b.classList.contains('tb-off'))
    if (!el || !shown.length) return
    const rects = shown.map((b) => b.getBoundingClientRect())
    let slot = rects.findIndex((r) => clientX < r.left + r.width / 2)
    if (slot < 0) slot = rects.length
    const from = shown.findIndex((b) => b.dataset.taskId === draggingId.value)
    if (slot === from || slot === from + 1) {
      dropLine.value = null
      return
    }
    // Past the last shown button, "before" is the first overflowed one, so the moved button
    // lands at the end of what is visible rather than behind everything hidden.
    beforeId =
      slot < shown.length
        ? (shown[slot]!.dataset.taskId ?? null)
        : (all[all.indexOf(shown[shown.length - 1]!) + 1]?.dataset.taskId ?? null)
    const boundary =
      slot === 0
        ? rects[0]!.left - GAP_CENTER
        : slot === rects.length
          ? rects[slot - 1]!.right + GAP_CENTER
          : (rects[slot - 1]!.right + rects[slot]!.left) / 2
    const box = el.getBoundingClientRect()
    dropLine.value = Math.min(Math.max(boundary - box.left, 1), box.width - 1)
  }

  function onMove(e: PointerEvent) {
    if (!press) return
    if (!draggingId.value) {
      if (Math.abs(e.clientX - press.x) < DRAG_THRESHOLD) return
      draggingId.value = press.id
    }
    measure(e.clientX)
  }

  function stop() {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', stop)
    press = null
    draggingId.value = null
    dropLine.value = null
  }

  function onUp() {
    const id = draggingId.value
    if (id) {
      // The click that follows this pointerup belongs to the drag, not to the button. It only
      // fires if the pointer came back to where it started, so the swallow expires right after.
      swallowClick = true
      setTimeout(() => (swallowClick = false), 0)
      if (dropLine.value !== null) reorder(id, beforeId)
    }
    stop()
  }

  function onPointerDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return
    press = { id, x: e.clientX }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', stop)
  }

  /** True when the click just fired ends a drag and should be ignored. */
  function clickWasDrag(): boolean {
    return swallowClick
  }

  // FLIP: remember where each button was before the order changes, then slide it from there.
  let before = new Map<string, number>()
  const signature = () => ids().join('\n')
  watch(
    signature,
    () => {
      before = new Map(
        buttons().map((b) => [b.dataset.taskId ?? '', b.getBoundingClientRect().left]),
      )
    },
    { flush: 'pre' },
  )
  watch(
    signature,
    () => {
      if (reducedMotion()) return
      for (const b of buttons()) {
        const was = before.get(b.dataset.taskId ?? '')
        if (was === undefined) continue
        const dx = was - b.getBoundingClientRect().left
        if (Math.abs(dx) >= 1)
          b.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], SLIDE)
      }
    },
    { flush: 'post' },
  )

  onBeforeUnmount(stop)

  return { dropLine, draggingId, onPointerDown, clickWasDrag }
}
