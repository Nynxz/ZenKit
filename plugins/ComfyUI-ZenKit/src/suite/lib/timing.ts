// Timing engine: derive per-node durations from ComfyUI's websocket execution events.
// `executing {node}` marks a node start (and the previous node's end); node=null ends the
// run. `execution_cached` lists skipped nodes; `progress` gives sub-node progress. All
// times via performance.now(). No backend — purely the live event stream.
import { reactive } from 'vue'
import { api } from '@comfy/api'
import { app } from '@comfy/app'

/* eslint-disable @typescript-eslint/no-explicit-any */

export type NodeStatus = 'running' | 'done' | 'cached' | 'error'
export interface NodeTiming {
  id: string
  title: string
  type: string
  start: number
  end: number | null
  duration: number | null // ms
  status: NodeStatus
  progress?: { value: number; max: number }
  groupId: string | null // top-level subgraph instance id (for grouping), null if root-level
  group: string | null // that subgraph node's title
}
export type RunStatus = 'idle' | 'running' | 'done' | 'error'
export interface TimerState {
  rows: NodeTiming[]
  status: RunStatus
  startedAt: number | null
  endedAt: number | null
  lastTotal: number | null // wall-clock ms of the most recent finished run
}

const now = () => performance.now()

interface Resolved {
  title: string
  type: string
  groupId: string | null
  group: string | null
}
// Subgraph nodes execute as locator ids "<subgraphNodeId>:<localId>" (nesting → more
// ":" segments). Walk the path from the root graph (each non-last segment is a subgraph
// node → descend into its .subgraph) to get the real node title, and the top-level
// subgraph node's title for grouping.
function resolve(id: string): Resolved {
  const segs = String(id).split(':')
  const groupId = segs.length > 1 ? segs[0] : null
  const get = (g: any, seg: string) =>
    g?.getNodeById?.(Number(seg)) ?? g?.getNodeById?.(seg) ?? null
  try {
    let g: any = (app as any).rootGraph ?? (app as any).graph
    let group: string | null = null
    for (let i = 0; i < segs.length - 1; i++) {
      const sg = get(g, segs[i])
      if (i === 0) group = sg ? sg.title || sg.type || '#' + segs[i] : '#' + segs[i]
      const sub = sg?.subgraph ?? (sg?.isSubgraphNode?.() ? sg.subgraph : null)
      if (!sub) {
        g = null
        break
      }
      g = sub
    }
    const last = segs[segs.length - 1]
    const n = g ? get(g, last) : null
    const fallbackGroup = group ?? (groupId ? '#' + groupId : null)
    if (n)
      return {
        title: n.title || n.type || '#' + last,
        type: String(n.type || ''),
        groupId,
        group: fallbackGroup,
      }
    return { title: '#' + last, type: '', groupId, group: fallbackGroup }
  } catch {
    return {
      title: '#' + segs[segs.length - 1],
      type: '',
      groupId,
      group: groupId ? '#' + groupId : null,
    }
  }
}

export function createTimer() {
  const state = reactive<TimerState>({
    rows: [],
    status: 'idle',
    startedAt: null,
    endedAt: null,
    lastTotal: null,
  })
  let current: NodeTiming | null = null

  function finishCurrent(t: number) {
    if (current && current.end == null) {
      current.end = t
      current.duration = t - current.start
      if (current.status === 'running') current.status = 'done'
    }
    current = null
  }
  function reset() {
    state.rows = []
    state.status = 'running'
    state.startedAt = now()
    state.endedAt = null
    current = null
  }
  function endRun(status: RunStatus, t: number) {
    state.status = status
    state.endedAt = t
    if (state.startedAt != null) state.lastTotal = t - state.startedAt
  }

  const onStart = () => reset()
  const onCached = (e: any) => {
    const nodes: any[] = e?.detail?.nodes || []
    const t = now()
    for (const raw of nodes) {
      const id = String(raw)
      const { title, type, groupId, group } = resolve(id)
      state.rows.push({
        id,
        title,
        type,
        start: t,
        end: t,
        duration: 0,
        status: 'cached',
        groupId,
        group,
      })
    }
  }
  const onExecuting = (e: any) => {
    const d = e?.detail
    const id = d && typeof d === 'object' ? d.node : d // some versions pass the id directly
    const t = now()
    finishCurrent(t)
    if (id == null || id === '') {
      if (state.status === 'running') endRun('done', t)
      return
    }
    if (state.status !== 'running') reset()
    const { title, type, groupId, group } = resolve(String(id))
    const row: NodeTiming = {
      id: String(id),
      title,
      type,
      start: t,
      end: null,
      duration: null,
      status: 'running',
      groupId,
      group,
    }
    state.rows.push(row)
    current = row
  }
  const onProgress = (e: any) => {
    if (!current) return
    const d = e?.detail
    if (d && typeof d.value === 'number') current.progress = { value: d.value, max: d.max || 0 }
  }
  const onError = () => {
    const t = now()
    if (current) current.status = 'error'
    finishCurrent(t)
    endRun('error', t)
  }
  const onSuccess = () => {
    const t = now()
    finishCurrent(t)
    if (state.status === 'running') endRun('done', t)
  }

  const handlers: [string, (e: any) => void][] = [
    ['execution_start', onStart],
    ['execution_cached', onCached],
    ['executing', onExecuting],
    ['progress', onProgress],
    ['execution_error', onError],
    ['execution_success', onSuccess],
  ]
  for (const [ev, fn] of handlers) (api as any).addEventListener(ev, fn)

  function dispose() {
    for (const [ev, fn] of handlers) (api as any).removeEventListener(ev, fn)
  }
  function clear() {
    state.rows = []
    state.status = 'idle'
    state.startedAt = null
    state.endedAt = null
    current = null
  }

  return { state, dispose, clear }
}
