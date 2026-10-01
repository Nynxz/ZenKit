import { api } from '@comfy/api'
import { getZenKit } from '@nynxz/zenkit-client'

// Turning media into something a vision model can take: a small JPEG data URL. Images are scaled
// down to MAX_SIDE; a video gives one frame from its first second or so.

const MAX_SIDE = 768

/** A media the user attached to a message. */
export interface Attachment {
  ref: string
  url: string
  kind: 'image' | 'video' | 'audio'
  label?: string
}

export async function resolveMedia(ref: string): Promise<Attachment> {
  const zen = getZenKit()
  if (!zen) return { ref, url: ref, kind: 'image' }
  const info = await zen.media.resolve(ref)
  return { ref, url: info.url, kind: info.kind, label: info.label }
}

function load<T extends HTMLImageElement | HTMLVideoElement>(el: T, src: string, ready: string): Promise<T> {
  return new Promise((resolve, reject) => {
    el.addEventListener(ready, () => resolve(el), { once: true })
    el.addEventListener('error', () => reject(new Error(`Could not load ${src}.`)), { once: true })
    el.src = src
  })
}

async function frameOf(media: Attachment): Promise<HTMLImageElement | HTMLVideoElement> {
  if (media.kind === 'image') return load(Object.assign(new Image(), { crossOrigin: 'anonymous' }), media.url, 'load')
  const video = Object.assign(document.createElement('video'), { muted: true, crossOrigin: 'anonymous', preload: 'auto' })
  await load(video, media.url, 'loadeddata')
  video.currentTime = Math.min(1, (video.duration || 2) / 2)
  await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }))
  return video
}

/** The media as a JPEG data URL a vision model can be sent. Audio has no picture. */
export async function snapshot(media: Attachment): Promise<string> {
  if (media.kind === 'audio') throw new Error(`${media.ref} is audio; there is nothing to look at.`)
  const source = await frameOf(media)
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h))
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * scale), height: Math.round(h * scale) })
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/** A file dropped from the desktop, uploaded to ComfyUI's input folder; returns its ref. */
export async function uploadLocal(url: string, filename = 'dropped.png'): Promise<string> {
  const blob = await (await fetch(url)).blob()
  const body = new FormData()
  body.append('image', new File([blob], filename, { type: blob.type }))
  body.append('subfolder', 'zenagent')
  const res = await (api as { fetchApi(path: string, init: RequestInit): Promise<Response> }).fetchApi('/upload/image', { method: 'POST', body })
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`)
  const saved = (await res.json()) as { name: string; subfolder?: string }
  return ['input', saved.subfolder, saved.name].filter(Boolean).join('/')
}
