// zen.media — media refs: one short string per image / video / audio, so a result from one
// capability can be handed to the next. ComfyUI's own files (input/, output/, temp/) are built
// in; plugins add sources for their own prefixes. Nothing else is a ref: a URL (http:, data:,
// blob:, '/path') is refused, so a ref taken from a workflow or a model can't make ZenKit fetch
// an arbitrary address or copy it into input/.
import { api } from '@comfy/api'
import type { MediaInfo, MediaRef, MediaSource, ZenMedia } from './types'

// Import the pure shared source, without loading the consumer SDK's runtime helpers.
import {
  COMFY_MEDIA_FOLDERS,
  mediaKindOf,
  parseMediaRef,
  type ComfyMediaFolder,
} from '../../client/src/mediaRefs'

export const kindOf = mediaKindOf

function parseComfyRef(ref: MediaRef) {
  const file = parseMediaRef(ref)
  if (!file) throw new Error(`"${ref}" is not a ComfyUI file ref.`)
  return file
}

function comfySource(type: ComfyMediaFolder): MediaSource {
  return {
    prefix: type,
    resolve: (ref) => {
      const file = parseComfyRef(ref)
      const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type })
      return {
        ref,
        url: api.apiURL(`/view?${q.toString()}`),
        kind: kindOf(file.filename),
        label: file.filename,
      }
    },
    // Loader nodes read output and temp files in place through ComfyUI's "[output]" annotation.
    toInput: async (ref) => {
      const file = parseComfyRef(ref)
      const path = file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename
      return type === 'input' ? path : `${path} [${type}]`
    },
  }
}

// A prefix is a plain word; URL schemes can't be registered, so they never become refs.
const PREFIX = /^[\w.-]+$/
const URL_SCHEMES = new Set('http https data blob javascript file about ws wss'.split(' '))

/** Whether a registered source's URL may be downloaded: same-origin, or in-page blob:/data:. */
function fetchable(url: string): boolean {
  try {
    const u = new URL(url, location.href)
    return u.origin === location.origin || u.protocol === 'blob:' || u.protocol === 'data:'
  } catch {
    return false
  }
}

/** Copy a registered source's media into ComfyUI's input folder; returns the loader widget
 *  value. Only for sources without their own `toInput`, and only from a same-origin, blob: or
 *  data: URL. */
async function uploadFrom(info: MediaInfo): Promise<string> {
  if (!fetchable(info.url)) throw new Error(`Won't copy ${info.ref} into input/: not a local URL.`)
  const res = await fetch(info.url)
  if (!res.ok) throw new Error(`Could not fetch ${info.ref} (${res.status}).`)
  const blob = await res.blob()
  const base = (
    info.label ??
    new URL(info.url, location.href).pathname.split('/').pop() ??
    'media'
  ).replace(/[^\w.-]+/g, '_')
  const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/\W.*/, '')
  const name = /\.\w{2,5}$/.test(base) || !ext ? base : `${base}.${ext}`
  const body = new FormData()
  body.append('image', new File([blob], name, { type: blob.type }))
  body.append('subfolder', 'zenkit')
  const up = await api.fetchApi('/upload/image', { method: 'POST', body })
  if (!up.ok) throw new Error(`Upload of ${info.ref} failed (${up.status}).`)
  const saved = (await up.json()) as { name: string; subfolder?: string }
  return saved.subfolder ? `${saved.subfolder}/${saved.name}` : saved.name
}

export function createMedia(): ZenMedia {
  const sources = new Map<string, MediaSource>(COMFY_MEDIA_FOLDERS.map((t) => [t, comfySource(t)]))

  const prefixOf = (ref: MediaRef) => /^[^:/]+/.exec(ref)?.[0] ?? ''

  function sourceFor(ref: MediaRef): MediaSource {
    const source = typeof ref === 'string' ? sources.get(prefixOf(ref)) : undefined
    if (!source)
      throw new Error(
        `Unknown media ref "${String(ref)}". Refs look like output/name.png (or input/, temp/, ` +
          `or a registered prefix); URLs are not refs.`,
      )
    return source
  }

  const resolve = async (ref: MediaRef): Promise<MediaInfo> => sourceFor(ref).resolve(ref)

  return {
    registerSource: (source) => {
      if (!PREFIX.test(source.prefix) || URL_SCHEMES.has(source.prefix.toLowerCase()))
        throw new Error(`"${source.prefix}" can't be a media ref prefix.`)
      sources.set(source.prefix, source)
      return () => {
        if (sources.get(source.prefix) === source) sources.delete(source.prefix)
      }
    },
    resolve,
    toInput: async (ref) => {
      const source = sourceFor(ref)
      if (source.toInput) return source.toInput(ref)
      return uploadFrom(await source.resolve(ref))
    },
    fromComfyFile: (file) =>
      [file.type ?? 'output', file.subfolder, file.filename].filter(Boolean).join('/'),
  }
}
