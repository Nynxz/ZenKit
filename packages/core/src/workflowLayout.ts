// The pure half of workflow workspaces: reading a workflow file's `extra.zenkit` (untrusted input),
// writing it back, and planning which panels a workflow switch closes and opens. No Vue, no
// ComfyUI, no DOM, so the rules are testable on their own (tests/workflowLayout.test.mjs).
import type { TileNode } from './tiling/engine'

/** A workflow's workspaces as stored in its file. */
export interface StoredWorkspace {
  id: string
  name: string
  tree: TileNode | null
}
export interface WorkflowLayout {
  workspaces: StoredWorkspace[]
  /** The workspace that was on screen, or null for the graph. */
  active: string | null
}
/** `extra.zenkit` in a workflow file. */
export interface ZenkitExtra extends WorkflowLayout {
  v: 1
}

export const LAYOUT_LIMITS = {
  workspaces: 16,
  depth: 8,
  tiles: 32,
  name: 48,
  panelId: 200,
} as const

const ID = /^[A-Za-z0-9_-]{1,32}$/
// Registered ids (`plugin:panel`, instances `type#n`) and node-bound ones
// (`pack:<graph uuid>:<node>`). Only an id, never rendered; anything else is dropped.
const PANEL_ID = /^[\w.:#@/-]+$/
// C0/C1 control characters and bidi overrides: a name is one plain line of text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g

export const isPanelId = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= LAYOUT_LIMITS.panelId && PANEL_ID.test(v)

/** A name as one short line of plain text; empty when nothing usable is left. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, LAYOUT_LIMITS.name).trim()
}

const clampRatio = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(0.95, Math.max(0.05, v)) : 0.5

/**
 * Rebuild a tile tree from untrusted data: known node shapes only, at most `depth` levels and
 * `budget.left` leaves, each panel at most once (`seen`). A split that loses a child collapses to
 * the other; anything malformed is dropped and counted in `budget.dropped`.
 */
export function sanitizeTree(
  node: unknown,
  seen: Set<string>,
  budget: { left: number; dropped: number },
  depth = 1,
): TileNode | null {
  if (!node || typeof node !== 'object') {
    if (node != null) budget.dropped++
    return null
  }
  const n = node as Record<string, unknown>
  if (n.type === 'leaf') {
    if (!isPanelId(n.id) || seen.has(n.id) || budget.left <= 0) {
      budget.dropped++
      return null
    }
    seen.add(n.id)
    budget.left--
    return { type: 'leaf', id: n.id }
  }
  if (
    n.type !== 'split' ||
    (n.axis !== 'row' && n.axis !== 'column') ||
    depth >= LAYOUT_LIMITS.depth
  ) {
    budget.dropped++
    return null
  }
  const a = sanitizeTree(n.a, seen, budget, depth + 1)
  const b = sanitizeTree(n.b, seen, budget, depth + 1)
  if (!a || !b) return a ?? b
  return { type: 'split', axis: n.axis, ratio: clampRatio(n.ratio), a, b }
}

export interface ParsedExtra {
  layout: WorkflowLayout | null
  /** Why something was ignored, for one console warning; null when the data was clean. */
  problem: string | null
}

/**
 * Read `extra.zenkit` from a workflow file. Absent → no layout and no problem. Malformed → no
 * layout and a problem. Partly bad → the good part, with a problem describing what was dropped.
 * Caps: LAYOUT_LIMITS. Ids that aren't plain tokens, or that repeat, are reissued.
 */
export function parseZenkitExtra(raw: unknown): ParsedExtra {
  if (raw === undefined || raw === null) return { layout: null, problem: null }
  if (typeof raw !== 'object' || Array.isArray(raw))
    return { layout: null, problem: 'extra.zenkit is not an object' }
  const r = raw as Record<string, unknown>
  if (r.v !== 1) return { layout: null, problem: `unknown extra.zenkit version ${String(r.v)}` }
  if (!Array.isArray(r.workspaces))
    return { layout: null, problem: 'extra.zenkit.workspaces is not a list' }

  const problems: string[] = []
  if (r.workspaces.length > LAYOUT_LIMITS.workspaces)
    problems.push(`kept the first ${LAYOUT_LIMITS.workspaces} of ${r.workspaces.length} workspaces`)
  const seen = new Set<string>()
  const ids = new Set<string>()
  const budget = { left: LAYOUT_LIMITS.tiles, dropped: 0 }
  const workspaces: StoredWorkspace[] = []
  const renamed = new Map<string, string>()
  for (const entry of r.workspaces.slice(0, LAYOUT_LIMITS.workspaces)) {
    if (!entry || typeof entry !== 'object') {
      problems.push('skipped a workspace that is not an object')
      continue
    }
    const e = entry as Record<string, unknown>
    let id = typeof e.id === 'string' && ID.test(e.id) && !ids.has(e.id) ? e.id : ''
    if (!id) {
      id = freshId(ids, 'f')
      if (typeof e.id === 'string') renamed.set(e.id, id)
    }
    ids.add(id)
    const name = cleanName(e.name) || `Workspace ${workspaces.length + 1}`
    workspaces.push({ id, name, tree: sanitizeTree(e.tree, seen, budget) })
  }
  if (budget.dropped) problems.push(`dropped ${budget.dropped} malformed, repeated or extra tiles`)
  const rawActive = typeof r.active === 'string' ? (renamed.get(r.active) ?? r.active) : null
  const active = rawActive && ids.has(rawActive) ? rawActive : null
  return {
    layout: { workspaces, active },
    problem: problems.length ? problems.join('; ') : null,
  }
}

/** The `extra.zenkit` to write for a workflow's workspaces; null when there are none. */
export function serializeLayout(layout: WorkflowLayout): ZenkitExtra | null {
  if (!layout.workspaces.length) return null
  const ids = new Set(layout.workspaces.map((w) => w.id))
  return {
    v: 1,
    workspaces: layout.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      tree: w.tree ? (JSON.parse(JSON.stringify(w.tree)) as TileNode) : null,
    })),
    active: layout.active && ids.has(layout.active) ? layout.active : null,
  }
}

/** An id not in `taken`: `<prefix>1`, `<prefix>2`, … */
export function freshId(taken: Set<string>, prefix: string): string {
  let n = 1
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

export function leafIds(node: TileNode | null, out: string[] = []): string[] {
  if (!node) return out
  if (node.type === 'leaf') out.push(node.id)
  else {
    leafIds(node.a, out)
    leafIds(node.b, out)
  }
  return out
}

function withoutLeaves(node: TileNode | null, drop: Set<string>): TileNode | null {
  if (!node) return null
  if (node.type === 'leaf') return drop.has(node.id) ? null : node
  const a = withoutLeaves(node.a, drop)
  const b = withoutLeaves(node.b, drop)
  if (!a || !b) return a ?? b
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

/**
 * Fit an incoming workflow's layout beside the global workspaces: an id a global already uses is
 * reissued, and a panel a global already tiles leaves the workflow's tree (a panel lives in one
 * tile).
 */
export function fitBesideGlobals(
  layout: WorkflowLayout,
  globals: { id: string; tree: TileNode | null }[],
): WorkflowLayout {
  const taken = new Set(globals.map((g) => g.id))
  const tiledGlobally = new Set(globals.flatMap((g) => leafIds(g.tree)))
  let active = layout.active
  const workspaces = layout.workspaces.map((w) => {
    let id = w.id
    if (taken.has(id)) {
      id = freshId(taken, 'f')
      if (active === w.id) active = id
    }
    taken.add(id)
    return { id, name: w.name, tree: withoutLeaves(w.tree, tiledGlobally) }
  })
  return { workspaces, active }
}

/**
 * What a workflow switch does to panels. `close`: open panels tiled only in the outgoing
 * workflow's workspaces (not in the incoming one's, nor a global's) that `canReopen` says can be
 * opened again later. `open`: panels tiled in the incoming workflow's workspaces that aren't open
 * and `canReopen` allows — only registered panels, so file content never names what renders.
 */
export function planSwap(args: {
  outgoing: (TileNode | null)[]
  incoming: (TileNode | null)[]
  globals: (TileNode | null)[]
  isOpen: (id: string) => boolean
  canReopen: (id: string) => boolean
}): { close: string[]; open: string[] } {
  const ids = (trees: (TileNode | null)[]) => new Set(trees.flatMap((t) => leafIds(t)))
  const incoming = ids(args.incoming)
  const globals = ids(args.globals)
  const close = [...ids(args.outgoing)].filter(
    (id) => !incoming.has(id) && !globals.has(id) && args.isOpen(id) && args.canReopen(id),
  )
  const open = [...incoming].filter(
    (id) => !globals.has(id) && !args.isOpen(id) && args.canReopen(id),
  )
  return { close, open }
}
