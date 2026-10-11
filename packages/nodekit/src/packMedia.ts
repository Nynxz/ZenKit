// The pack's own media routes (`/<ns>/media/thumb`, `/info`, `/find`, served by the vendored
// Python from `zenkit-nodekit sync`) as frontend helpers. Every URL goes through `api.apiURL`, so
// they work when ComfyUI is served under a base path. `createNodekit` binds them to the pack's
// `route('media')`.
import { api } from '@comfy/api'
import { shallowRef } from 'vue'

import { mediaKind, parseMediaRef, uploadMediaFile } from './mediaRefs'

/** What `GET <route>/info` reports. Null where the server can't tell (or lacks PyAV). */
export interface MediaInfo {
  kind: 'image' | 'video' | 'audio'
  /** Seconds; null for a picture. */
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  hasAudio: boolean | null
}

export interface PackMedia {
  /** A small cached JPEG of a picture, or of a video's frame at `t` seconds (its first frame by
   *  default); `''` for audio and non-refs. Reactive: until the server is known to take `t` (an
   *  older vendored route answers every time with the first frame), it's the first frame's URL. */
  thumbUrl(ref: string, size?: number, t?: number): string
  /** The ref of `file` in the input folder: a copy whose bytes are already there (under any name),
   *  or else a fresh upload into `input/<subfolder>`. Fits `readMediaDrop`'s `upload` argument. */
  uploadOrReuse(file: File, subfolder?: string): Promise<string>
  /** Kind, length, size, frame rate and sound of a ref's file, read by the server; null when the
   *  file is missing or unreadable. */
  mediaInfo(ref: string): Promise<MediaInfo | null>
}

const apiUrl = (path: string) => (api as { apiURL: (p: string) => string }).apiURL(path)

async function sha256(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null // only in secure contexts (https, localhost)
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Helpers for the media routes under `route` (the pack's `route('media')`). */
export function createPackMedia(route: string): PackMedia {
  // The server only hashes input files of the same size, so a lookup is cheap. Any failure just
  // means "not found": the file is uploaded as usual.
  async function existingInput(file: File): Promise<string | null> {
    try {
      const hash = await sha256(file)
      if (!hash) return null
      const query = new URLSearchParams({ size: String(file.size), sha256: hash })
      const res = await fetch(apiUrl(`${route}/find?${query}`))
      if (!res.ok) return null
      return ((await res.json()) as { ref: string | null }).ref
    } catch {
      return null
    }
  }

  // Whether the thumb route takes `t`: it answers with X-Thumb-Time when it does. An older copy
  // of the route ignores `t`, and its first-frame answer would then be cached (immutably) under
  // the URL with `t` — so `t` goes into URLs only once a first request has shown it's understood.
  // Asked once, with the first such URL; a failed request (a missing file, say) asks again later.
  const timed = shallowRef<boolean | null>(null)
  let asking = false
  function probe(url: string) {
    if (asking) return
    asking = true
    fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) timed.value = res.headers.has('X-Thumb-Time')
      })
      .catch(() => undefined)
      .finally(() => (asking = false))
  }

  return {
    thumbUrl(ref, size = 256, t) {
      const parsed = parseMediaRef(ref)
      if (!parsed || mediaKind(ref) === 'audio') return ''
      const name = parsed.subfolder ? `${parsed.subfolder}/${parsed.filename}` : parsed.filename
      const query = new URLSearchParams({ type: parsed.type, name, size: String(size) })
      const first = apiUrl(`${route}/thumb?${query}`)
      if (!t || !(t > 0) || mediaKind(ref) !== 'video') return first
      query.set('t', t.toFixed(6))
      const at = apiUrl(`${route}/thumb?${query}`)
      if (timed.value) return at
      if (timed.value === null) probe(at)
      return first
    },
    async uploadOrReuse(file, subfolder = 'zenkit') {
      return (await existingInput(file)) ?? uploadMediaFile(file, subfolder)
    },
    async mediaInfo(ref) {
      try {
        const res = await fetch(apiUrl(`${route}/info?${new URLSearchParams({ ref })}`))
        if (!res.ok) return null
        const raw = (await res.json()) as Record<string, unknown>
        const num = (v: unknown) => (typeof v === 'number' ? v : null)
        return {
          kind: (raw.kind as MediaInfo['kind']) ?? mediaKind(ref),
          duration: num(raw.duration),
          width: num(raw.width),
          height: num(raw.height),
          fps: num(raw.fps),
          hasAudio: typeof raw.has_audio === 'boolean' ? raw.has_audio : null,
        }
      } catch {
        return null
      }
    },
  }
}
