// ZenKit shared viewer service. Owns ONE fullscreen lightbox for the whole page — any
// plugin calls window.ZenKit.viewer.open(items) instead of bundling its own copy. The
// lightbox itself is the @nynxz/zenkit-ui primitive (ZenLightbox); this just manages the single
// live instance (mount on open, tear down on close). Graceful fallback when ZenKit is absent
// lives in @nynxz/zenkit-client (openViewer → new tab).
import { createApp, h, reactive, type App } from 'vue'
import { ZenLightbox } from '@nynxz/zenkit-ui'
import type { ViewerHandle, ViewerItem, ZenViewer } from '@nynxz/zenkit-types'

export function createViewer(): ZenViewer {
  const state = reactive<{ items: ViewerItem[]; index: number }>({ items: [], index: 0 })
  let appInst: App | null = null
  let mountEl: HTMLElement | null = null

  function close(): void {
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
  }

  function open(items: ViewerItem[], opts: { index?: number } = {}): ViewerHandle {
    close() // single instance — replace any open viewer
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
          },
          onClose: close,
        }),
    })
    appInst.mount(mountEl)
    return {
      close,
      setIndex: (i: number) => {
        state.index = i
      },
    }
  }

  return { open, close }
}
