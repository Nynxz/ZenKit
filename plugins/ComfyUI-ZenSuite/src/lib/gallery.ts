// Gallery: a spawn-only Media-Viewer-without-the-channels. `openGallery(items)` pops
// a fresh ZenSuite Gallery panel seeded with a static list of media — no compare, no
// sync, no channel bus. Any plugin/panel can call it (Asset Browser, ZenStash, a
// node…) via window.ZenSuite.openGallery or the 'zensuite:open-gallery' bus event.

import { createApp, type Component } from 'vue'
import {
  getZenKit,
  type PanelContext,
  type PanelHandle,
  type ZenKitApi,
} from '@nynxz/zenkit-client'
import type { LightboxItem } from '@nynxz/zenkit-ui'
import GalleryViewer from '@/components/GalleryViewer.vue'

export interface GalleryPayload {
  title?: string
  icon?: string
  items: LightboxItem[]
  index?: number
}

// Items can't be passed through PanelSpec, so a freshly-opened gallery picks its
// payload up here by id on mount (then it persists them via ctx for reloads).
const pending = new Map<string, GalleryPayload>()
export function takePendingGallery(id?: string): GalleryPayload | null {
  if (!id) return null
  const p = pending.get(id) ?? null
  if (p) pending.delete(id)
  return p
}

function mounter(component: Component) {
  return (el: HTMLElement, ctx?: PanelContext) => {
    const a = createApp(component, { ctx })
    a.mount(el)
    return () => a.unmount()
  }
}
const galleryRender = mounter(GalleryViewer)

// Registered once (spawnOnly = hidden from ZenBar/taskbar; multi = many at once).
export const GALLERY_PANEL = {
  id: 'zensuite:gallery',
  title: 'Gallery',
  icon: 'mdi mdi-image-multiple',
  render: galleryRender,
  multi: true,
  spawnOnly: true,
  width: 760,
  height: 660,
  minWidth: 360,
  minHeight: 320,
}

let seq = 0

/** Open a fresh Gallery panel showing `items`. Returns the panel handle (or null if
 *  ZenKit is absent / no items). The caller can then setTitle/setIcon on it. */
export function openGallery(
  payload: GalleryPayload,
  zen: ZenKitApi | null = getZenKit(),
): PanelHandle | null {
  if (!zen) {
    console.warn('[ZenSuite] openGallery: ZenKit not available')
    return null
  }
  const items = (payload?.items || []).filter((i) => i && i.src)
  if (!items.length) {
    console.warn('[ZenSuite] openGallery: no items')
    return null
  }
  // Mint our own instance id so we can stash the payload before the panel mounts.
  const id = `zensuite:gallery#${++seq}_${Math.random().toString(36).slice(2, 7)}`
  pending.set(id, { ...payload, items })
  return zen.panels.open({
    id,
    instanceOf: 'zensuite:gallery',
    title: payload.title || 'Gallery',
    icon: payload.icon || GALLERY_PANEL.icon,
    render: galleryRender,
    width: GALLERY_PANEL.width,
    height: GALLERY_PANEL.height,
    minWidth: GALLERY_PANEL.minWidth,
    minHeight: GALLERY_PANEL.minHeight,
  })
}

/** Expose openGallery to other plugins: window.ZenSuite.openGallery + a bus event. */
export function installGalleryApi(zen: ZenKitApi) {
  const w = window as unknown as { ZenSuite?: Record<string, unknown> }
  w.ZenSuite = { ...(w.ZenSuite || {}), openGallery: (p: GalleryPayload) => openGallery(p, zen) }
  zen.bus.on('zensuite:open-gallery', (p) => openGallery(p as GalleryPayload, zen))
}
