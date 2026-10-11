// ZenPeek's pure logic: what an element asks to peek at, and where the window goes. Kept out of the
// component so it can be tested without a DOM.

/** What a peek shows: a media URL (image, video, audio) or content the host draws (`custom`). */
export type PeekKind = 'image' | 'video' | 'audio' | 'custom'

/** Elements ZenPeek watches: a media URL in `data-peek`, or host-drawn content. */
export const PEEK_SELECTOR = '[data-peek], [data-peek-kind="custom"]'

/** The `data-peek*` attributes of a peekable element, as read from its `dataset`. */
export interface PeekData {
  peek?: string
  peekKind?: string
  peekId?: string
  peekLabel?: string
  peekDetail?: string
}

export interface PeekTarget {
  kind: PeekKind
  /** The media URL ('' for custom content). */
  url: string
  /** The host's id for custom content (`data-peek-id`, else `data-peek`); '' for media. */
  id: string
  label: string
  detail: string
  /** Same key, same content: a new key replaces what's shown. */
  key: string
}

/** A media URL's kind, from its extension; anything unknown is shown as an image. */
export function guessKind(url: string): Exclude<PeekKind, 'custom'> {
  return /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(url)
    ? 'video'
    : /\.(wav|mp3|flac|ogg|m4a|aac)(\?|$)/i.test(url)
      ? 'audio'
      : 'image'
}

/** What an element's `data-peek*` attributes ask for, or null when there is nothing to show. */
export function peekTarget(d: PeekData): PeekTarget | null {
  const label = d.peekLabel ?? ''
  const detail = d.peekDetail ?? ''
  if (d.peekKind === 'custom') {
    const id = d.peekId ?? d.peek ?? ''
    return id ? { kind: 'custom', url: '', id, label, detail, key: `custom:${id}` } : null
  }
  const url = d.peek
  if (!url) return null
  const kind =
    d.peekKind === 'image' || d.peekKind === 'video' || d.peekKind === 'audio'
      ? d.peekKind
      : guessKind(url)
  return { kind, url, id: '', label, detail, key: `${kind}:${url}` }
}

export interface Rect {
  left: number
  top: number
  right: number
  height: number
}

/** Beside the thumbnail (`r`), on whichever side has room, centred on it; kept `margin` px inside
 *  the viewport. `w`/`h` are the window's size. */
export function placePeek(
  r: Rect,
  w: number,
  h: number,
  viewport: { width: number; height: number },
  gap = 12,
  margin = 8,
): { left: number; top: number } {
  const room = viewport.width - r.right
  let left = room >= w + gap || room >= r.left ? r.right + gap : r.left - w - gap
  left = Math.min(Math.max(margin, left), viewport.width - w - margin)
  const top = Math.min(Math.max(margin, r.top + r.height / 2 - h / 2), viewport.height - h - margin)
  return { left, top }
}

/** Above the element (below it when there's no room above), centred on it across; kept `margin`
 *  px inside the viewport. For wide things (a clip on a timeline) the window would cover. */
export function placePeekAbove(
  r: Rect & { width: number },
  w: number,
  h: number,
  viewport: { width: number; height: number },
  gap = 10,
  margin = 8,
): { left: number; top: number } {
  const below = r.top + r.height + gap
  let top = r.top - h - gap
  if (top < margin && below + h <= viewport.height - margin) top = below
  top = Math.min(Math.max(margin, top), viewport.height - h - margin)
  const left = Math.min(Math.max(margin, r.left + r.width / 2 - w / 2), viewport.width - w - margin)
  return { left, top }
}

/** What a ZenPeek `render` callback gets besides the id and the container it fills. */
export interface PeekRenderContext {
  /** The element being peeked at. */
  el: HTMLElement
  /** The system asks for reduced motion: draw something still. */
  reducedMotion: boolean
  /** Re-place the window (call after changing the content's size). */
  place: () => void
}
/** Draws custom content into `container`; returns a cleanup run when the peek closes or moves on. */
export type PeekRender = (
  id: string,
  container: HTMLElement,
  ctx: PeekRenderContext,
) => void | (() => void)
