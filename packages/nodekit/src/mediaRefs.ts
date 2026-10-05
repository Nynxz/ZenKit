// Media refs for node widgets: one string per picture (`input/sub/name.png`, `output/...`), the
// same refs ZenKit's `zen.media` uses, so a widget can store what was dropped on it, show it, and
// hand it to Python, which loads it from ComfyUI's folders. Works with or without the ZenKit
// runtime.
import { api } from '@comfy/api'

import { viewUrl } from './viewUrl'
// ZEN_IMAGE_MIME: what ZenKit's drag sources (Media Viewer, Asset Browser, Stash…) put on a drag.
// COMFY_ASSET_MIME: ComfyUI's own asset browser.
import { COMFY_ASSET_MIME, mediaKindOf, ZEN_IMAGE_MIME } from './zenkit'

const FOLDERS = ['input', 'output', 'temp']

/** `output/sub/name.png` → its folder, subfolder and name; null for anything else. */
export function parseMediaRef(ref: string): { type: string; subfolder: string; filename: string } | null {
  const [type, ...rest] = ref.split('/')
  const filename = rest.pop()
  if (!type || !filename || !FOLDERS.includes(type)) return null
  return { type, subfolder: rest.join('/'), filename }
}

/** What a ref (or file name) holds, from its extension; GIF is an image. The client's
 *  `mediaKindOf`, under the name packs know it by. */
export const mediaKind: (ref: string) => 'image' | 'video' | 'audio' = mediaKindOf

/** A URL that shows the ref's file. */
export function mediaRefUrl(ref: string): string {
  const parsed = parseMediaRef(ref)
  return parsed ? viewUrl(parsed) : ref
}

function refFromViewUrl(url: string): string | null {
  try {
    const u = new URL(url, location.href)
    const filename = u.searchParams.get('filename')
    if (!u.pathname.endsWith('/view') || !filename) return null
    return [u.searchParams.get('type') || 'output', u.searchParams.get('subfolder'), filename].filter(Boolean).join('/')
  } catch {
    return null
  }
}

function json(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Upload a file into ComfyUI's input folder (under `subfolder`); returns its ref. */
export async function uploadMediaFile(file: File, subfolder = 'zenkit'): Promise<string> {
  const body = new FormData()
  body.append('image', file)
  body.append('subfolder', subfolder)
  const res = await (api as { fetchApi(p: string, i: RequestInit): Promise<Response> }).fetchApi('/upload/image', {
    method: 'POST',
    body,
  })
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`)
  const saved = (await res.json()) as { name: string; subfolder?: string }
  return ['input', saved.subfolder, saved.name].filter(Boolean).join('/')
}

/** Whether a dragover carries something `readMediaDrop` can use (only `types` is readable then). */
export function hasMediaDrop(e: DragEvent): boolean {
  const types = e.dataTransfer?.types ?? []
  return types.includes(ZEN_IMAGE_MIME) || types.includes(COMFY_ASSET_MIME) || types.includes('text/uri-list') || types.includes('Files')
}

/** The media refs a drop carries, uploading desktop files into `input/<subfolder>`. Reads the
 *  drop synchronously before awaiting anything (a DataTransfer empties once its event returns),
 *  so call it from the drop handler itself. Call `preventDefault` when you accept the drop.
 *  `upload` replaces the plain upload, e.g. with one that reuses a file the server already has. */
export async function readMediaDrop(
  e: DragEvent,
  subfolder = 'zenkit',
  upload: (file: File, subfolder: string) => Promise<string> = uploadMediaFile,
): Promise<string[]> {
  const dt = e.dataTransfer
  if (!dt) return []
  const zen = json(dt.getData(ZEN_IMAGE_MIME))
  const asset = json(dt.getData(COMFY_ASSET_MIME))
  const uri = (dt.getData('text/uri-list') || '').split('\n')[0]?.trim() ?? ''
  const files = Array.from(dt.files).filter((f) => /^(image|video|audio)\//.test(f.type))

  if (zen) {
    const ref = typeof zen.ref === 'string' && parseMediaRef(zen.ref) ? zen.ref : typeof zen.url === 'string' ? refFromViewUrl(zen.url) : null
    if (ref) return [ref]
  }
  if (asset && typeof asset.filename === 'string')
    return [[String(asset.type || 'input'), String(asset.subfolder || ''), asset.filename].filter(Boolean).join('/')]
  const fromUri = uri ? refFromViewUrl(uri) : null
  if (fromUri) return [fromUri]
  return Promise.all(files.map((f) => upload(f, subfolder)))
}
