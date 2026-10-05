// What a media picker browses: ComfyUI's input / output / temp folders, every subfolder, as media
// refs (`input/sub/name.png`). Listing and thumbnails come from the pack's own routes (the
// vendored `_zenkit/media_api.py`, from `zenkit-nodekit sync`); full files and uploads use
// ComfyUI's /view and /upload/image. Items match `MediaPickerItem` in @nynxz/zenkit-ui, so a
// library plugs straight into ZenMediaPicker.
import { api } from '@comfy/api'

import { mediaRefUrl, uploadMediaFile } from './mediaRefs'

export type MediaRoot = 'input' | 'output' | 'temp'
export type MediaKind = 'image' | 'video' | 'audio'

export interface MediaLibraryItem {
  ref: string
  root: MediaRoot
  folder: string
  filename: string
  kind: MediaKind
  size: number
  mtime: number
  url: string
  thumb?: string
}

export interface MediaLibrary {
  roots: MediaRoot[]
  list(root: MediaRoot, force?: boolean): Promise<MediaLibraryItem[]>
  /** Upload desktop files into `input/<subfolder>`, reusing a file already there. */
  upload(files: File[], subfolder?: string): Promise<string[]>
}

const apiUrl = (path: string) => (api as { apiURL: (p: string) => string }).apiURL(path)

/** A library backed by a listing route (`GET <route>?type=input`) and `<route>/thumb`. */
export function createMediaLibrary(route: string): MediaLibrary {
  const cache = new Map<MediaRoot, Promise<MediaLibraryItem[]>>()

  async function fetchRoot(root: MediaRoot): Promise<MediaLibraryItem[]> {
    const res = await fetch(apiUrl(`${route}?type=${root}`))
    if (!res.ok) throw new Error(`Could not list ${root}/ (${res.status}).`)
    const data = (await res.json()) as { items?: Record<string, unknown>[] }
    return (data.items ?? []).map((raw) => {
      const name = String(raw.name)
      const ref = `${root}/${name}`
      const mtime = Number(raw.mtime) || 0
      const kind = (raw.kind as MediaKind) ?? 'image'
      const thumbQuery = new URLSearchParams({ type: root, name, size: '320', v: String(mtime) })
      return {
        ref,
        root,
        folder: String(raw.subfolder ?? ''),
        filename: String(raw.filename ?? name.split('/').pop()),
        kind,
        size: Number(raw.size) || 0,
        mtime,
        url: mediaRefUrl(ref),
        thumb: kind === 'audio' ? undefined : apiUrl(`${route}/thumb?${thumbQuery}`),
      }
    })
  }

  return {
    roots: ['input', 'output', 'temp'],
    list(root, force = false) {
      if (force || !cache.has(root)) {
        const pending = fetchRoot(root)
        pending.catch(() => cache.delete(root))
        cache.set(root, pending)
      }
      return cache.get(root)!
    },
    async upload(files, subfolder = 'zenkit') {
      const existing = await this.list('input').catch(() => [])
      const bySignature = new Map(existing.map((it) => [`${it.filename}|${it.size}`, it.ref]))
      const refs: string[] = []
      for (const file of files) {
        const hit = bySignature.get(`${file.name}|${file.size}`)
        if (hit) {
          refs.push(hit)
          continue
        }
        const ref = await uploadMediaFile(file, subfolder)
        bySignature.set(`${file.name}|${file.size}`, ref)
        refs.push(ref)
      }
      cache.delete('input')
      return refs
    },
  }
}
