import {
  hasMediaDragData,
  readMediaDragData,
  readMediaListDragData,
  ZEN_MEDIA_LIST_MIME,
} from '@nynxz/zenkit-client'
import { ref } from 'vue'

import type { Attachment } from './vision'
import { resolveMedia, uploadLocal } from './vision'

/**
 * Media dropped on a surface (from a viewer, the Asset Browser, Stash, the desktop) handed to
 * `onMedia` as attachments: refs the agent can use and pictures a vision model can see. Bind the
 * handlers on the surface's root; `dropping` is true while something droppable is over it.
 */
export function useMediaDrop(onMedia: (media: Attachment[]) => void) {
  const dropping = ref(false)
  function onDragOver(e: DragEvent): void {
    if (!hasMediaDragData(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dropping.value = true
  }
  function onDragLeave(e: DragEvent): void {
    const to = e.relatedTarget as Node | null
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) dropping.value = false
  }
  async function onDrop(e: DragEvent): Promise<void> {
    dropping.value = false
    const isList = e.dataTransfer?.types.includes(ZEN_MEDIA_LIST_MIME) ?? false
    if (!isList && !readMediaDragData(e).length) return
    e.preventDefault()
    e.stopPropagation()
    const { items: dropped } = await readMediaListDragData(e)
    const media = await Promise.all(
      dropped.slice(0, 8).map(async (it): Promise<Attachment | null> => {
        try {
          if (!it.objectUrl)
            return {
              ref: it.ref ?? it.url,
              url: it.url,
              kind: it.kind ?? 'image',
              label: it.filename,
            }
          const ref = await uploadLocal(it.url, it.filename)
          URL.revokeObjectURL(it.url)
          return await resolveMedia(ref)
        } catch {
          return null
        }
      }),
    )
    onMedia(media.filter((m) => m !== null))
  }
  return { dropping, onDragOver, onDragLeave, onDrop }
}
