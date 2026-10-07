// Pure media helpers shared by the SDK, runtime and node widgets.
export const COMFY_MEDIA_FOLDERS = ['output', 'input', 'temp'] as const
export type ComfyMediaFolder = (typeof COMFY_MEDIA_FOLDERS)[number]

/** A ComfyUI file ref, or null for URLs, absolute paths and empty/dot path segments. */
export function parseMediaRef(
  ref: string,
): { type: ComfyMediaFolder; subfolder: string; filename: string } | null {
  if (typeof ref !== 'string') return null
  const [type, ...rest] = ref.split('/')
  const filename = rest.pop()
  if (!filename || !COMFY_MEDIA_FOLDERS.includes(type as ComfyMediaFolder)) return null
  if ([...rest, filename].some((seg) => !seg || seg === '.' || seg === '..')) return null
  return { type: type as ComfyMediaFolder, subfolder: rest.join('/'), filename }
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v)(\?|#|$)/i
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus)(\?|#|$)/i

/** Guess the media kind from a filename or url. A `data:` URI is read from its media type,
 *  since it has no extension to go on. Anything else, GIF included, is an image (the default,
 *  matching ChannelImage). */
export function mediaKindOf(nameOrUrl: string): 'image' | 'video' | 'audio' {
  const s = nameOrUrl || ''
  const data = /^data:(image|video|audio)\//i.exec(s)
  if (data) return data[1]!.toLowerCase() as 'image' | 'video' | 'audio'
  if (VIDEO_EXT.test(s)) return 'video'
  if (AUDIO_EXT.test(s)) return 'audio'
  return 'image'
}
