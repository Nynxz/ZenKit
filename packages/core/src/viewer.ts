// ZenKit shared viewer service. Owns ONE fullscreen lightbox for the whole page — any
// plugin calls window.ZenKit.viewer.open(items) instead of bundling its own copy. The
// lightbox itself is the @nynxz/zenkit-ui primitive (ZenLightbox); this just manages the single
// live instance (mount on open, tear down on close). Graceful fallback when ZenKit is absent
// lives in @nynxz/zenkit-client (openViewer → new tab).
import { createApp, h, reactive, type App } from 'vue'
import { ZenLightbox } from '@nynxz/zenkit-ui'
import type { ViewerHandle, ViewerItem, ViewerOpenOptions, ZenViewer } from '@nynxz/zenkit-types'

export function createViewer(): ZenViewer {
  const state = reactive<{ items: ViewerItem[]; index: number }>({ items: [], index: 0 })
  let appInst: App | null = null
  let mountEl: HTMLElement | null = null
  let onClose: (() => void) | undefined

  function close(): void {
    const notify = onClose
    onClose = undefined
    if (appInst) {
      try {
        appInst.unmount()
      } catch {
        /* already gone */
      }
      appInst = null
    }
    if (mountEl) {
      mountEl.remove()
      mountEl = null
    }
    notify?.()
  }

  function open(items: ViewerItem[], opts: ViewerOpenOptions = {}): ViewerHandle {
    close() // single instance — replace any open viewer
    onClose = opts.onClose
    state.items = Array.isArray(items) ? items : []
    state.index = Math.max(0, Math.min(opts.index ?? 0, state.items.length - 1))
    mountEl = document.createElement('div')
    document.body.appendChild(mountEl)
    appInst = createApp({
      render: () =>
        h(ZenLightbox, {
          items: state.items,
          index: state.index,
          'onUpdate:index': (i: number) => {
            state.index = i
            opts.onIndex?.(i)
          },
          onClose: close,
        }),
    })
    appInst.mount(mountEl)
    return {
      close,
      setIndex: (i: number) => {
        state.index = i
        opts.onIndex?.(i)
      },
    }
  }

  return { open, close }
}
