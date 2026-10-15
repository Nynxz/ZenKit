/**
 * More than one view of a mounted widget: the node body and any number of mirrors elsewhere (a
 * Zen Bind list, a panel), each its own instance of the widget's component, kept in step.
 *
 * Components read `widget.value` when they mount and write it back on change; they don't watch
 * it. So a view stays current by being remounted when ANOTHER view writes a new value. A mirror
 * gets the widget through a proxy that records it as the writer, which is how the others know to
 * refresh and it doesn't. Writes that change nothing (a component normalising on mount) refresh
 * nobody, which is what keeps two views from remounting each other forever.
 *
 * The handle lives on the widget object (`widget.zenMirror`) because the widget is the one thing
 * every bundle shares: a pack's nodekit mounts it, and ZenKit's Zen Bind, a separate bundle,
 * mirrors it.
 */

export interface ZenMirror {
  /** The widget stretches into the height it's given rather than hugging its content. */
  fill: boolean
  /** Mount another view of the widget into `el`. Returns the unmount. */
  mount: (el: HTMLElement) => () => void
}

/** The widget's mirror handle, when the widget was mounted by a nodekit that offers one. */
export function mirrorOf(widget: unknown): ZenMirror | null {
  const handle = (widget as { zenMirror?: ZenMirror } | null)?.zenMirror
  return handle && typeof handle.mount === 'function' ? handle : null
}

interface View {
  refresh: () => void
}

export interface MirrorHub {
  /** Call from the widget's setValue, after storing `next`, with the value it replaced. */
  changed: (previous: unknown, next: unknown) => void
  /** Register a view; `refresh` remounts it. Returns the unregister. */
  add: (view: View) => () => void
  /** A widget for `view` to write through, so its own writes don't refresh it. */
  writerFor: <W extends object>(widget: W, view: View) => W
  /** The original body's view: writes through the real widget count as its. */
  original: View
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function createMirrorHub(refreshOriginal: () => void): MirrorHub {
  const views = new Set<View>()
  const original: View = { refresh: refreshOriginal }
  let writer: View | null = null
  const pending = new Set<View>()
  let scheduled = false

  function flush() {
    scheduled = false
    const due = [...pending]
    pending.clear()
    for (const view of due) {
      try {
        view.refresh()
      } catch (err) {
        console.error('[ZenKit] widget mirror refresh failed', err)
      }
    }
  }

  return {
    original,
    changed(previous, next) {
      if (same(previous, next)) return
      const source = writer ?? original
      for (const view of [original, ...views]) if (view !== source) pending.add(view)
      if (!pending.size || scheduled) return
      scheduled = true
      queueMicrotask(flush)
    },
    add(view) {
      views.add(view)
      return () => {
        views.delete(view)
        pending.delete(view)
      }
    },
    writerFor(widget, view) {
      return new Proxy(widget, {
        set(target, key, value) {
          if (key !== 'value') return Reflect.set(target, key, value)
          const outer = writer
          writer = view
          try {
            ;(target as { value: unknown }).value = value
          } finally {
            writer = outer
          }
          return true
        },
      })
    },
  }
}
