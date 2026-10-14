// Live output feed: turns ComfyUI's `executed` websocket event into the
// file-backed items a run just wrote to disk, so the Asset Browser can show a
// generation the moment it lands instead of waiting for a manual refresh.
//
// The harvesting rules mirror ZenFlow's engine (plugins/ComfyUI-ZenFlow/src/lib/
// engine.ts) because the same two subtleties bite here:
//   * don't gate on the workflow's declared output node ids — flattening a
//     subgraph for execution remaps them, so the ids won't match;
//   * iterate EVERY output key, not just images/video/audio, so a custom output
//     node's own key is captured too, as long as it carries {filename, ...}.
//
// Unlike ZenFlow we deliberately do NOT filter by prompt_id: the browser reflects
// whatever the server writes, including runs queued from another tab or the API.

import { api } from '@comfy/api'

export interface LiveOutput {
  filename: string
  /** Posix-ish relative dir, '' at the root — matches the backend's `subfolder`. */
  subfolder: string
  /** ComfyUI's ResultItem type, which is exactly the browser's asset root. */
  type: string
  kind: 'image' | 'video' | 'audio' | 'other'
}

// Infer media kind from the output key so custom output nodes work, not just SaveImage.
const kindOfKey = (k: string): LiveOutput['kind'] =>
  /audio/i.test(k)
    ? 'audio'
    : /(video|gif|webm|mp4|webp_anim|animated)/i.test(k)
      ? 'video'
      : 'image'

/** Subscribe to executed-node outputs. Returns an unsubscribe function. */
export function watchOutputs(onOutputs: (items: LiveOutput[]) => void): () => void {
  const handler = (e: { detail?: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (e?.detail as any) || {}
    const out = d.output || {}
    const found: LiveOutput[] = []
    for (const [key, arr] of Object.entries(out)) {
      if (!Array.isArray(arr)) continue
      const kind = kindOfKey(key)
      for (const entry of arr) {
        if (!entry || typeof entry !== 'object' || !('filename' in entry)) continue
        const r = entry as { filename?: unknown; subfolder?: unknown; type?: unknown }
        const filename = String(r.filename ?? '')
        if (!filename) continue
        found.push({
          filename,
          subfolder: String(r.subfolder ?? ''),
          type: String(r.type ?? 'output'),
          kind,
        })
      }
    }
    if (found.length) onOutputs(found)
  }
  api.addEventListener('executed', handler)
  return () => api.removeEventListener('executed', handler)
}
