// One shared view of the LoRA folder for every widget that picks from it. Module-level rather
// than a composable: a graph can hold a dozen LoRA nodes, and per-component state would mean a
// dozen fetches and a dozen places for a fresh bookmark to be stale.

import { computed, ref } from 'vue'

import type { LoraInfo, LoraItem, LoraPreviewKind, LoraSource } from './types'

/**
 * The host pack's backend. Set once, at plugin start.
 *
 * A module-level singleton rather than provide/inject because the store below is one too: a
 * graph can hold a dozen LoRA widgets and they must share one listing. Each pack bundles its
 * own copy of this package, so one pack's source can never clobber another's.
 */
let source: LoraSource | null = null

export function setLoraSource(next: LoraSource): void {
  source = next
  // A new backend invalidates anything already fetched from the old one.
  pending = null
  listLoaded.value = false
  infoCache.clear()
}

function required(): LoraSource {
  if (!source) {
    throw new Error(
      '[zenkit-ui] No LoRA source registered — call setLoraSource() before rendering a LoRA picker.',
    )
  }
  return source
}

/** Every LoRA on disk. Empty until `ensure()` has resolved at least once. */
export const loras = ref<LoraItem[]>([])
/** Bookmarked names. */
export const favorites = ref<string[]>([])
/** Whether the listing has arrived; before that, "not in the list" means "not loaded yet". */
export const listLoaded = ref(false)

const favSet = computed(() => new Set(favorites.value))
const known = computed(() => new Set(loras.value.map((l) => l.name)))

// Sets are replaced rather than mutated: Vue's reactivity does not track Set membership, so a
// `.add()` on a ref'd Set updates nothing on screen.
const previewable = ref<Set<string>>(new Set())
const thumbFailed = ref<Set<string>>(new Set())

let pending: Promise<void> | null = null

/**
 * Load the listing and favourites once, shared across every caller.
 *
 * Call it on first picker open rather than on mount — a graph full of LoRA nodes would otherwise
 * hit both endpoints on every graph load — and on mount only for a node that already has a name
 * to validate.
 */
export function ensure(force = false): Promise<void> {
  if (force) pending = null
  if (!pending) {
    const src = required()
    pending = Promise.all([src.list(force), src.favorites(force)]).then(([ls, fs]) => {
      loras.value = ls
      favorites.value = fs
      previewable.value = new Set(ls.filter((l) => l.has_preview).map((l) => l.name))
      listLoaded.value = true
    })
  }
  return pending
}

/** `characters/ada_v2.safetensors` -> `ada_v2`. */
export function short(name: unknown): string {
  const base = String(name).split('/').pop() || String(name)
  return base.replace(/\.(safetensors|pt|ckpt|bin|lora)$/i, '')
}

/** `characters/ada_v2.safetensors` -> `characters`, or "" for a LoRA at the root. */
export function folder(name: unknown): string {
  const parts = String(name).split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

export function hasPreview(name: unknown): boolean {
  return previewable.value.has(String(name))
}

export function preview(name: unknown): string {
  return required().previewUrl(String(name))
}

const kinds = computed(
  () => new Map(loras.value.map((l) => [l.name, l.preview ?? (l.has_preview ? 'image' : null)])),
)

/** The preview's kind, or null if it has none (or the listing hasn't loaded). */
export function previewKind(name: unknown): LoraPreviewKind | null {
  return kinds.value.get(String(name)) ?? null
}

/** The preview as-is: the video itself for a video preview. */
export function media(name: unknown): string {
  const src = required()
  return src.mediaUrl ? src.mediaUrl(String(name)) : src.previewUrl(String(name))
}

export function hasInfo(): boolean {
  return !!source?.info
}

const infoCache = new Map<string, Promise<LoraInfo | null>>()

/** Details for one LoRA, fetched once per session. */
export function info(name: unknown): Promise<LoraInfo | null> {
  const n = String(name)
  const src = source
  if (!n || !src?.info) return Promise.resolve(null)
  let p = infoCache.get(n)
  if (!p) {
    p = src.info(n).catch(() => null)
    infoCache.set(n, p)
  }
  return p
}

export function isFav(name: unknown): boolean {
  return favSet.value.has(String(name))
}

export async function toggleFav(name: unknown): Promise<void> {
  favorites.value = await required().setFavorite(String(name), !isFav(name))
}

/** A chosen LoRA that is no longer on disk. False until the listing has loaded. */
export function isMissing(name: unknown): boolean {
  const n = String(name)
  return listLoaded.value && !!n && !known.value.has(n)
}

/**
 * Whether to try a thumbnail for a SELECTED name.
 *
 * Optimistic before the listing loads, so a saved LoRA's thumb appears on mount instead of
 * flashing a placeholder; `onThumbError` demotes it if the request 404s. Once the listing is in,
 * `previewable` is authoritative.
 */
export function hasThumb(name: unknown): boolean {
  const n = String(name)
  if (!n || thumbFailed.value.has(n)) return false
  return listLoaded.value ? previewable.value.has(n) : true
}

/** A selected-row thumbnail that failed to load — stop offering it. */
export function onThumbError(name: unknown): void {
  thumbFailed.value = new Set(thumbFailed.value).add(String(name))
}

/** An <img> in a list that failed to load — drop it from `previewable` and hide the element. */
export function onImageError(e: Event): void {
  const img = e.target as HTMLImageElement
  const name = decodeURIComponent(new URL(img.src).searchParams.get('name') || '')
  if (name && previewable.value.has(name)) {
    const next = new Set(previewable.value)
    next.delete(name)
    previewable.value = next
  }
  img.style.display = 'none'
}
