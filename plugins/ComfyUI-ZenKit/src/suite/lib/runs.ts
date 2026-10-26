// Finished runs, kept so they can be looked back on, averaged and compared. Pure: the Timer
// panel records them from the timing engine and stores them (see `parseRuns` for the format).
import type { NodeStatus, NodeTiming, RunStatus } from './timing'

export interface RunNode {
  id: string
  title: string
  type: string
  /** ms; 0 for a cached node. */
  duration: number
  status: Exclude<NodeStatus, 'running'>
  groupId: string | null
  group: string | null
}
export interface RunRecord {
  id: string
  /** When it finished (epoch ms). */
  at: number
  /** The workflow on screen when it started. */
  workflow: string
  status: Exclude<RunStatus, 'idle' | 'running'>
  /** Wall-clock ms. */
  total: number
  nodes: RunNode[]
  /** For an average: how many runs went into it. */
  of?: number
}

/** How many runs are kept; the oldest go first. */
export const RUNS_MAX = 100

/** A node across runs: the same id running the same node type. */
export const nodeKey = (n: { id: string; type: string }) => `${n.id}|${n.type}`

/** A finished run as kept: its rows' times, and nothing live. */
export function recordOf(
  rows: NodeTiming[],
  run: { id: string; at: number; workflow: string; status: RunRecord['status']; total: number },
): RunRecord {
  return {
    ...run,
    nodes: rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      duration: r.status === 'cached' ? 0 : (r.duration ?? 0),
      status: r.status === 'running' ? 'error' : r.status,
      groupId: r.groupId,
      group: r.group,
    })),
  }
}

/** Add a run to the kept ones, newest first, keeping at most `max`. */
export function keep(runs: RunRecord[], run: RunRecord, max = RUNS_MAX): RunRecord[] {
  return [run, ...runs.filter((r) => r.id !== run.id)].slice(0, max)
}

type Ran = { nodes: { id: string; type: string; status: NodeStatus }[] }
const ran = (r: Ran) => r.nodes.filter((n) => n.status !== 'cached')

/** The runs an average or a comparison draws on: one workflow's runs that finished and did
 *  some work (a run that was all cached says nothing about speed). */
export const comparable = (runs: RunRecord[], workflow: string) =>
  runs.filter((r) => r.workflow === workflow && r.status === 'done' && ran(r).length > 0)

/** Whether two runs executed the same nodes, so their totals can be compared: with different
 *  nodes cached, one total covers work the other skipped. */
export function sameWork(a: Ran, b: Ran): boolean {
  const keys = (r: Ran) => ran(r).map(nodeKey).sort().join(',')
  return keys(a) === keys(b)
}

/** The average of `runs` (newest first): the mean total, and each node's mean over the runs it
 *  actually ran in (a run where it was cached doesn't count for it). Nodes in the newest run's
 *  order, then any only older runs had. Null for no runs. */
export function averageOf(runs: RunRecord[]): RunRecord | null {
  if (!runs.length) return null
  const sums = new Map<string, { node: RunNode; ms: number; ran: number }>()
  for (const run of runs)
    for (const n of run.nodes) {
      const k = nodeKey(n)
      const s = sums.get(k) ?? { node: n, ms: 0, ran: 0 }
      if (n.status !== 'cached') {
        s.ms += n.duration
        s.ran++
      }
      sums.set(k, s)
    }
  const nodes = [...sums.values()].map(({ node, ms, ran }) => ({
    ...node,
    duration: ran ? ms / ran : 0,
    status: ran ? ('done' as const) : ('cached' as const),
  }))
  return {
    id: 'avg:' + runs[0].workflow,
    at: runs[0].at,
    workflow: runs[0].workflow,
    status: 'done',
    total: runs.reduce((t, r) => t + r.total, 0) / runs.length,
    nodes,
    of: runs.length,
  }
}

/** How much slower (+) or faster (−) each node ran than in `base`, in ms, by node. A node that
 *  was cached on either side, or that `base` doesn't have, has no delta. */
export function deltasAgainst(
  nodes: { id: string; type: string; duration: number; status: NodeStatus }[],
  base: RunRecord,
): Map<string, number> {
  const before = new Map(base.nodes.map((n) => [nodeKey(n), n]))
  const out = new Map<string, number>()
  for (const n of nodes) {
    const b = before.get(nodeKey(n))
    if (!b || b.status === 'cached' || n.status === 'cached') continue
    out.set(nodeKey(n), n.duration - b.duration)
  }
  return out
}

const isNode = (v: unknown): v is RunNode => {
  const n = v as RunNode | null
  return (
    !!n &&
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.type === 'string' &&
    typeof n.duration === 'number' &&
    (n.status === 'done' || n.status === 'cached' || n.status === 'error')
  )
}
/** Kept runs as stored, dropping anything malformed. */
export function parseRuns(raw: unknown): RunRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((v) => {
    const r = v as RunRecord | null
    if (
      !r ||
      typeof r.id !== 'string' ||
      typeof r.at !== 'number' ||
      typeof r.workflow !== 'string' ||
      (r.status !== 'done' && r.status !== 'error') ||
      typeof r.total !== 'number' ||
      !Array.isArray(r.nodes)
    )
      return []
    return [
      {
        id: r.id,
        at: r.at,
        workflow: r.workflow,
        status: r.status,
        total: r.total,
        nodes: r.nodes.filter(isNode).map((n) => ({
          ...n,
          groupId: typeof n.groupId === 'string' ? n.groupId : null,
          group: typeof n.group === 'string' ? n.group : null,
        })),
      },
    ]
  })
}
