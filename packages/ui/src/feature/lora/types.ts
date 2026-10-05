// The LoRA picker's data contract. ZenKit owns the UI; each pack owns its backend and hands
// one of these in via `setLoraSource`, so the components never reference a pack's routes.

export type LoraPreviewKind = 'image' | 'video'

export interface LoraItem {
  /** Relative path, '/'-separated (e.g. "characters/ada_v2.safetensors"). */
  name: string
  has_preview: boolean
  /** What the preview file is. `previewUrl` is always a still; a video plays via `mediaUrl`. */
  preview?: LoraPreviewKind | null
  favorite?: boolean
  /** File size, bytes. */
  size?: number | null
  /** Last modified, epoch seconds. */
  mtime?: number | null
}

/** One example generation (e.g. a Civitai showcase image). */
export interface LoraExample {
  url: string
  /** Where `url` was downloaded from, used if `url` fails to load. */
  remote?: string | null
  kind: LoraPreviewKind
  width?: number | null
  height?: number | null
  /** Civitai scale: 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX. */
  nsfw_level?: number
  /** Generation params as published (prompt, negativePrompt, steps, sampler, seed, …). */
  meta: Record<string, string | number | boolean | (string | number)[]>
}

/** Everything known about one LoRA. Every field but `name` may be absent. */
export interface LoraInfo {
  name: string
  title?: string | null
  version?: string | null
  base_model?: string | null
  creator?: string | null
  url?: string | null
  sha256?: string | null
  size?: number | null
  preview?: LoraPreviewKind | null
  favorite?: boolean
  trigger_words?: string[]
  tags?: string[]
  description?: string
  version_description?: string
  notes?: string
  /** Lora Manager usage tips, e.g. `{ strength: 0.8 }`. */
  usage?: Record<string, string | number | boolean>
  images?: LoraExample[]
  /** Training metadata from the file header (kohya `ss_*`). */
  training?: Record<string, string | string[]>
}

/** Everything the picker needs from a host pack. */
export interface LoraSource {
  /** Every LoRA on disk. `force` bypasses the pack's own cache. */
  list(force?: boolean): Promise<LoraItem[]>
  /** A same-origin URL for a LoRA's preview as a still image. */
  previewUrl(name: string): string
  /** The preview as-is (a video for a video preview). Defaults to `previewUrl`. */
  mediaUrl?(name: string): string
  /** Details for the info panel; null when unavailable. */
  info?(name: string): Promise<LoraInfo | null>
  /** Bookmarked names. */
  favorites(force?: boolean): Promise<string[]>
  /** Pin/unpin a name; resolves to the new complete list. */
  setFavorite(name: string, pinned: boolean): Promise<string[]>
}
