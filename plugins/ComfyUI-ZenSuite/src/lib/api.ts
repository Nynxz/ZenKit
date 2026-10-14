// Fetch helpers for the ZenSuite Asset Browser. Full files are served by
// ComfyUI's own /view route; thumbnails + listing come from /zensuite/.

export type AssetRoot = 'output' | 'input' | 'temp'

export interface AssetItem {
  rel: string
  name: string
  subfolder: string
  ext: string
  kind: 'image' | 'video' | 'audio' | 'model3d' | 'other'
  mtime: number
  size: number
  has_workflow: boolean
  node_count: number
}

export interface AssetList {
  root: AssetRoot
  dir: string
  items: AssetItem[]
  truncated: boolean
  error?: string
}

export interface RootInfo {
  name: AssetRoot
  dir: string
  exists: boolean
}

export async function listRoots(): Promise<RootInfo[]> {
  try {
    const r = await fetch('/zensuite/roots')
    const j = await r.json()
    return (j.roots as RootInfo[]) || []
  } catch {
    return []
  }
}

export async function listAssets(root: AssetRoot): Promise<AssetList> {
  const r = await fetch(`/zensuite/assets?root=${encodeURIComponent(root)}`)
  return r.json()
}

/** What visual search did for a search: ranked the matches by what the images show, or not:
 *  it wasn't asked for (or no model is chosen), a workflow is running, or the search was
 *  filters only. */
export type VisualMode = 'ranked' | 'off' | 'busy' | 'filters'

export interface SearchResult {
  /** Best first when `visual` is 'ranked'. */
  rels: string[]
  visual: VisualMode
  /** How many lead `rels` as close matches; ranked, the rest are weaker ones, best first. */
  close: number
}

/** The files in `root` matching a search: words in the prompt, file name, model or loras,
 *  "phrases", and filters such as sampler:euler seed:123 steps:20 cfg:7 lora:x neg:x kind:video.
 *  With `visual` (and a model chosen), the free text also ranks images by what they show —
 *  which loads the embedding model. */
export async function searchAssets(
  root: AssetRoot,
  q: string,
  visual = false,
): Promise<SearchResult> {
  const r = await fetch(
    `/zensuite/search?root=${encodeURIComponent(root)}&q=${encodeURIComponent(q)}${visual ? '&visual=1' : ''}`,
  )
  const body = (await r.json()) as Partial<SearchResult> & { error?: string }
  if (body.error) throw new Error(body.error)
  const rels = body.rels ?? []
  return { rels, visual: body.visual ?? 'off', close: body.close ?? rels.length }
}

export interface VisualStatus {
  /** Embedding models in models/embedders. */
  models: string[]
  /** The chosen one; null when visual search is off. */
  model: string | null
  state: 'idle' | 'loading' | 'indexing' | 'paused' | 'error'
  /** Files embedded, and files of a kind the model embeds that aren't yet. */
  done: number
  pending: number
  total: number
  error: string
}

export async function visualStatus(): Promise<VisualStatus> {
  return (await fetch('/zensuite/visual')).json()
}

export async function setVisualModel(model: string | null): Promise<VisualStatus> {
  const r = await fetch('/zensuite/visual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
  const body = await r.json()
  if (body.error) throw new Error(body.error)
  return body
}

/** Embed the files not embedded yet, in the background. */
export async function indexVisual(): Promise<VisualStatus> {
  const r = await fetch('/zensuite/visual/index', { method: 'POST' })
  const body = await r.json()
  if (body.error) throw new Error(body.error)
  return body
}

/** A small JPEG of an image, or a video's first frame. `version` (the file's mtime) goes in the
 *  URL so the server can let the browser cache it indefinitely: a changed file is a new URL. */
export function thumbUrl(root: AssetRoot, rel: string, size = 256, version?: number): string {
  const v = version ? `&v=${Math.round(version)}` : ''
  return `/zensuite/thumb?root=${root}&rel=${encodeURIComponent(rel)}&size=${size}${v}`
}

/** Full-resolution / video URL via ComfyUI's own view route (output/input/temp). */
export function viewUrl(item: AssetItem, root: AssetRoot): string {
  const sub = item.subfolder || ''
  return `/view?filename=${encodeURIComponent(item.name)}&subfolder=${encodeURIComponent(sub)}&type=${root}`
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
