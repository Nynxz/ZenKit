import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue'
import type { DeepReadonly, Ref } from 'vue'

import type { ViewerHandle, ViewerItem } from '@nynxz/zenkit-types'
import { openViewer } from './index'

export interface Lightbox {
  /** Whether this lightbox is showing. */
  isOpen: DeepReadonly<Ref<boolean>>
  /** The item being shown; follows arrows, thumbnails and the slideshow. */
  index: DeepReadonly<Ref<number>>
  /** Show `items` in ZenKit's viewer (a new tab for the first one when ZenKit is absent). */
  open(items: ViewerItem[], opts?: { index?: number }): Promise<void>
  /** Jump to another item while open. */
  show(index: number): void
  close(): void
}

/**
 * ZenKit's shared lightbox, from a component: one viewer for the whole page, owned by ZenKit, so
 * every plugin gets the same (current) one instead of bundling its own copy. Closes itself when
 * the calling component or effect scope goes away.
 *
 *   const lightbox = useLightbox()
 *   lightbox.open(items, { index: 3 })
 */
export function useLightbox(): Lightbox {
  const isOpen = ref(false)
  const index = ref(0)
  let handle: ViewerHandle | null = null

  async function open(items: ViewerItem[], opts: { index?: number } = {}) {
    index.value = opts.index ?? 0
    const opened = await openViewer(items, {
      index: index.value,
      onIndex: (i) => (index.value = i),
      onClose: () => {
        if (handle === opened) {
          handle = null
          isOpen.value = false
        }
      },
    })
    handle = opened
    isOpen.value = opened !== null
  }

  const close = () => handle?.close()
  const show = (i: number) => handle?.setIndex(i)
  if (getCurrentScope()) onScopeDispose(close)

  return { isOpen: readonly(isOpen), index: readonly(index), open, show, close }
}
