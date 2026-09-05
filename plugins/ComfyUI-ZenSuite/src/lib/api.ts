// Fetch helpers for the ZenSuite Asset Browser. Full files are served by
// ComfyUI's own /view route; thumbnails + listing come from /zensuite/.

export type AssetRoot = 'output' | 'input' | 'temp'

export interface AssetItem {
  rel: string
  name: string
  subfolder: string
  ext: string
  kind: 'image' | 'video' | 'audio' | 'other'
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

export function thumbUrl(root: AssetRoot, rel: string, size = 256): string {
  return `/zensuite/thumb?root=${root}&rel=${encodeURIComponent(rel)}&size=${size}`
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
