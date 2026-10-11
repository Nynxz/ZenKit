// The pure half of "kept" workspace panels: a panel closed with `{ keep: true }` while tiled (one
// following its workspace that stepped aside, or a node's panel whose workflow went to the
// background) still belongs to its workspace, so the workspace's count and menu list it. A tile
// whose node was deleted doesn't: it is pruned. No Vue, no ComfyUI, so the rules are testable on
// their own (tests/keptPanels.test.mjs).
import { cleanName, isPanelId } from './workflowLayout'

/** What a kept panel shows as in a workspace's menu while it isn't open. */
export interface KeptMeta {
  title: string
  icon: string
}

export const KEPT_MAX = 200
export const KEPT_ICON = 'mdi mdi-application-outline'

// `<pack>:<graph uuid>:<node id>` — the id a node-bound panel takes (see the popout pattern in
// docs/wiki/Nodekit-Panels-and-Canvas.md). Anything else isn't bound to a node.
const NODE_PANEL =
  /^[\w.@/#-]+:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([\w-]+)$/i
// An icon is a list of class names, nothing else.
const ICON = /^[\w -]{1,80}$/

/** The graph and node a node-bound panel id names; null for any other id. */
export function nodePanelRef(id: string): { graph: string; node: string } | null {
  const m = NODE_PANEL.exec(id)
  return m ? { graph: m[1].toLowerCase(), node: m[2] } : null
}

/** The tiles a workspace lists and counts: its panels that are open, or closed but kept. A tile
 *  that is neither (closed for good elsewhere, or never reopened) doesn't count. */
export function panelsHere(
  tileIds: string[],
  isOpen: (id: string) => boolean,
  isKept: (id: string) => boolean,
): string[] {
  return tileIds.filter((id) => isOpen(id) || isKept(id))
}

/**
 * The tiles left behind by deleted nodes: closed (an open panel is its owner's business),
 * node-bound, in a graph the workflow on screen has (`nodesOf` returns its node ids; null for a
 * graph it doesn't have — another workflow's, or a graph that was just cleared for a load), and
 * whose node isn't in that graph.
 */
export function staleTiles(
  tileIds: string[],
  isOpen: (id: string) => boolean,
  nodesOf: (graphId: string) => Set<string> | null,
): string[] {
  const graphs = new Map<string, Set<string> | null>()
  return tileIds.filter((id) => {
    if (isOpen(id)) return false
    const ref = nodePanelRef(id)
    if (!ref) return false
    if (!graphs.has(ref.graph)) graphs.set(ref.graph, nodesOf(ref.graph))
    const nodes = graphs.get(ref.graph)
    return !!nodes && !nodes.has(ref.node)
  })
}

/** Kept panels as stored: `[id, { title, icon }]` pairs, the most recent last, at most KEPT_MAX. */
export function serializeKept(kept: Iterable<[string, KeptMeta]>): [string, KeptMeta][] {
  return [...kept].slice(-KEPT_MAX).map(([id, m]) => [id, { title: m.title, icon: m.icon }])
}

/** Read stored kept panels (untrusted): valid ids only, titles as one plain line, icons as class
 *  names; at most KEPT_MAX. */
export function parseKept(raw: unknown): Map<string, KeptMeta> {
  const out = new Map<string, KeptMeta>()
  if (!Array.isArray(raw)) return out
  for (const entry of raw.slice(-KEPT_MAX)) {
    if (!Array.isArray(entry) || !isPanelId(entry[0])) continue
    const m = (entry[1] ?? {}) as Partial<Record<keyof KeptMeta, unknown>>
    out.delete(entry[0])
    out.set(entry[0], {
      title: cleanName(m.title) || entry[0],
      icon: typeof m.icon === 'string' && ICON.test(m.icon) ? m.icon : KEPT_ICON,
    })
  }
  return out
}

/** Note a kept panel, moving it to the most recent end and dropping the oldest past KEPT_MAX. */
export function rememberKept(kept: Map<string, KeptMeta>, id: string, meta: KeptMeta): void {
  kept.delete(id)
  kept.set(id, meta)
  while (kept.size > KEPT_MAX) kept.delete(kept.keys().next().value as string)
}
