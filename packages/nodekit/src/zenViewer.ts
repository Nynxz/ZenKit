// Optional ZenKit shared viewer — open a fullscreen lightbox via the host RUNTIME instead of
// bundling our own copy of the lightbox. Talks to window.ZenKit directly (no @nynxz/zenkit-client
// dependency, matching this plugin's stance); when ZenKit isn't installed it gracefully falls
// back to opening the image in a new tab. One viewer for every plugin, owned by the host.

export interface ViewerItem {
  src: string
  kind?: 'image' | 'video'
  label?: string
  meta?: string
}

interface ZenKitLike {
  viewer?: { open(items: ViewerItem[], opts?: { index?: number }): unknown }
}

function getZenKit(): ZenKitLike | null {
  return (
    (typeof window !== 'undefined' && (window as unknown as { ZenKit?: ZenKitLike }).ZenKit) || null
  )
}

/** Open `items` in the shared ZenKit viewer at `index`; new-tab fallback without ZenKit. */
export function openViewer(items: ViewerItem[], index = 0): void {
  const zen = getZenKit()
  if (zen?.viewer?.open) {
    try {
      zen.viewer.open(items, { index })
      return
    } catch {
      /* fall through to the tab fallback */
    }
  }
  const it = items[index]
  if (it && typeof window !== 'undefined') window.open(it.src, '_blank', 'noopener')
}
