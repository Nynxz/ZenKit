// zen.media — media refs: one short string per image / video / audio, so a result from one
// capability can be handed to the next. ComfyUI's own files and plain URLs are built in;
// plugins add sources for their own prefixes.
import { api } from '@comfy/api'
import type { MediaInfo, MediaRef, MediaSource, ZenMedia } from './types'

const VIDEO = /\.(mp4|webm|mov|mkv|gif)$/i
const AUDIO = /\.(mp3|wav|flac|ogg|m4a)$/i
export const kindOf = (name: string): MediaInfo['kind'] =>
  VIDEO.test(name) ? 'video' : AUDIO.test(name) ? 'audio' : 'image'

const COMFY_FOLDERS = ['output', 'input', 'temp'] as const
type ComfyFolder = (typeof COMFY_FOLDERS)[number]

/** `output/sub/name.png` → its folder, subfolder and file name. */
function parseComfyRef(ref: MediaRef) {
  const [folder, ...rest] = ref.split('/')
  const filename = rest.pop()
  if (!filename || !COMFY_FOLDERS.includes(folder as ComfyFolder)) throw new Error(`"${ref}" is not a ComfyUI file ref.`)
  return { type: folder as ComfyFolder, subfolder: rest.join('/'), filename }
}

function comfySource(type: ComfyFolder): MediaSource {
  return {
    prefix: type,
    resolve: (ref) => {
      const file = parseComfyRef(ref)
      const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type })
      return { ref, url: api.apiURL(`/view?${q.toString()}`), kind: kindOf(file.filename), label: file.filename }
    },
    // Loader nodes read output and temp files in place through ComfyUI's "[output]" annotation.
    toInput: async (ref) => {
      const file = parseComfyRef(ref)
      const path = file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename
      return type === 'input' ? path : `${path} [${type}]`
    },
  }
}

const URL_REF = /^(https?:|data:|blob:|\/)/

/** Copy anything with a URL into ComfyUI's input folder; returns the loader widget value. */
async function uploadFrom(info: MediaInfo): Promise<string> {
  const res = await fetch(info.url)
  if (!res.ok) throw new Error(`Could not fetch ${info.ref} (${res.status}).`)
  const blob = await res.blob()
  const base = (info.label ?? new URL(info.url, location.href).pathname.split('/').pop() ?? 'media').replace(/[^\w.-]+/g, '_')
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
  const sources = new Map<string, MediaSource>(COMFY_FOLDERS.map((t) => [t, comfySource(t)]))

  const prefixOf = (ref: MediaRef) => /^[^:/]+/.exec(ref)?.[0] ?? ''

  function sourceFor(ref: MediaRef): MediaSource | null {
    if (URL_REF.test(ref)) return null
    const source = sources.get(prefixOf(ref))
    if (!source) throw new Error(`Unknown media ref "${ref}". Refs look like output/name.png, or a URL.`)
    return source
  }

  async function resolve(ref: MediaRef): Promise<MediaInfo> {
    const source = sourceFor(ref)
    if (source) return source.resolve(ref)
    const name = ref.split(/[?#]/)[0]!.split('/').pop() ?? ref
    return { ref, url: ref, kind: kindOf(name), label: name }
  }

  return {
    registerSource: (source) => {
      sources.set(source.prefix, source)
      return () => {
        if (sources.get(source.prefix) === source) sources.delete(source.prefix)
      }
    },
    resolve,
    toInput: async (ref) => {
      const source = sourceFor(ref)
      if (source?.toInput) return source.toInput(ref)
      return uploadFrom(await resolve(ref))
    },
    fromComfyFile: (file) =>
      [file.type ?? 'output', file.subfolder, file.filename].filter(Boolean).join('/'),
  }
}
