// Live-page access. Everything the ComfyUI runtime knows that no HTTP route reports:
// which extensions actually finished registering, which node types LiteGraph really has,
// and what the open workflow uses. All of it is best-effort — the host surface differs
// across frontend versions, so every reader returns a "don't know" value rather than
// throwing, and the UI is careful never to render an unknown as a failure.
import { app } from '@comfy/app'
import { api } from '@comfy/api'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const host = (): Any => app as Any

/** LiteGraph namespace — multi-fallback (mirrors @nynxz/zenkit-core's graph.ts). */
function liteGraph(): Any {
  const w = window as Any
  return (
    w.LiteGraph ??
    w.comfyAPI?.litegraph?.LiteGraph ??
    host()?.canvas?.constructor?.LiteGraph ??
    null
  )
}

/** Node types LiteGraph has actually registered, or `null` if LiteGraph is unreachable.
 *  The null case matters: it's the difference between "this node failed to register" and
 *  "we couldn't check", and those must not look the same in the UI. */
export function registeredNodeTypes(): Set<string> | null {
  try {
    const types = liteGraph()?.registered_node_types
    if (!types || typeof types !== 'object') return null
    const set = new Set<string>(Object.keys(types))
    return set.size ? set : null
  } catch {
    return null
  }
}

/** Names from `app.extensions` — the extensions whose JS loaded AND called
 *  registerExtension. A pack that ships JS which throws on import never lands here. */
export function extensionNames(): string[] {
  try {
    const list = host()?.extensions
    if (!Array.isArray(list)) return []
    return list
      .map((e: Any) => (typeof e === 'string' ? e : e?.name))
      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0)
  } catch {
    return []
  }
}

/** Node type → instance count in the open workflow (top-level graph only; nodes nested
 *  inside subgraph definitions aren't walked). */
export function graphNodeTypes(): Map<string, number> {
  const out = new Map<string, number>()
  try {
    const graph = host()?.graph
    const nodes: Any[] = graph?._nodes ?? graph?.nodes ?? []
    for (const n of nodes) {
      const t = n?.type ?? n?.comfyClass
      if (typeof t !== 'string' || !t) continue
      out.set(t, (out.get(t) ?? 0) + 1)
    }
  } catch {
    /* no graph yet */
  }
  return out
}

/** GET as JSON through ComfyUI's api client, so a non-root deployment (`--base-directory`,
 *  a reverse proxy subpath) resolves correctly. Every PromptServer route is mirrored under
 *  `/api`, which is what fetchApi targets — including our own /zeninspector/inspect. */
export async function getJson<T>(route: string): Promise<T> {
  const res = await (api as Any).fetchApi(route, { headers: { accept: 'application/json' } })
  if (!res?.ok) throw new Error(`HTTP ${res?.status ?? '?'} for ${route}`)
  return (await res.json()) as T
}

/** Focus the canvas on the first instance of a node type in the open workflow.
 *  Returns false when the type isn't on the canvas (or the host can't do it). */
export function revealNode(type: string): boolean {
  try {
    const a = host()
    const nodes: Any[] = a?.graph?._nodes ?? a?.graph?.nodes ?? []
    const node = nodes.find((n: Any) => (n?.type ?? n?.comfyClass) === type)
    if (!node) return false
    a.canvas?.centerOnNode?.(node)
    a.canvas?.selectNode?.(node)
    a.canvas?.setDirty?.(true, true)
    return true
  } catch {
    return false
  }
}
