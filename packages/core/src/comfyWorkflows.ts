// ComfyUI's open workflows, seen from ZenKit: which tab is active, the open and saved ones, and
// switching or closing tabs through ComfyUI's own paths. ComfyUI's workflow store is reactive in
// ComfyUI's copy of Vue, which ZenKit's watchers can't see, so this listens to its store actions
// and graph events instead and keeps a snapshot (`wf`) ZenKit's components can render.
import { reactive, watch } from 'vue'
import { api } from '@comfy/api'
import { app } from '@comfy/app'
import type { WorkflowInfo, ZenKitApi } from './types'

interface Tracker {
  activeState?: { extra?: Record<string, unknown> } | null
  captureCanvasState?: () => void
  checkState?: () => void
}
/** The parts of ComfyUI's ComfyWorkflow this reads. */
export interface ComfyWorkflowLike {
  path: string
  filename: string
  isTemporary: boolean
  isModified: boolean
  isLoaded: boolean
  activeState: { extra?: Record<string, unknown> } | null
  changeTracker?: Tracker | null
  load(): Promise<ComfyWorkflowLike>
}
interface WorkflowStore {
  activeWorkflow: ComfyWorkflowLike | null
  openWorkflows: ComfyWorkflowLike[]
  workflows: ComfyWorkflowLike[]
  $onAction?: (
    cb: (ctx: { name: string; args: unknown[]; after: (fn: () => void) => void }) => void,
  ) => () => void
}
interface Graph {
  id?: string
  extra?: Record<string, unknown>
  _nodes?: { id?: unknown }[]
  nodes?: { id?: unknown }[]
  subgraphs?: { get?(id: string): Graph | undefined }
}
interface ComfyApp {
  extensionManager?: {
    workflow?: WorkflowStore
    command?: { execute(id: string): unknown }
    setting?: { get(id: string): unknown }
  }
  graph?: Graph
  rootGraph?: Graph
  loadGraphData(
    data: unknown,
    clean?: boolean,
    restoreView?: boolean,
    workflow?: unknown,
  ): Promise<unknown>
  registerExtension?(ext: Record<string, unknown>): void
}

/** One open tab, as the workflow menu shows it (`zen.workflows`' WorkflowInfo). */
export type WorkflowEntry = WorkflowInfo

const PINS_KEY = 'zenkit.workflowPins.v1'
const MAX_PINS = 24

export const wf = reactive({
  /** Open tabs in ComfyUI's tab order. */
  open: [] as WorkflowEntry[],
  /** The active tab's key, null before ComfyUI has one. */
  current: null as string | null,
  /** Pinned workflow keys (saved paths, or an open temporary tab's key), in pin order. */
  pinned: loadPins(),
})

const comfy = () => app as unknown as ComfyApp
const store = (): WorkflowStore | null => comfy().extensionManager?.workflow ?? null
/** ComfyUI's reactive proxies and raw objects compare equal through this. */
export const rawOf = <T>(o: T): T => ((o as { __v_raw?: T } | null)?.__v_raw ?? o) as T
const displayName = (w: ComfyWorkflowLike) => w.filename.replace(/\.json$/i, '')

export function activeWorkflow(): ComfyWorkflowLike | null {
  const w = store()?.activeWorkflow
  return w ? rawOf(w) : null
}
export const workflowName = (w: ComfyWorkflowLike) => displayName(w)

export function openWorkflows(): ComfyWorkflowLike[] {
  return (store()?.openWorkflows ?? []).map(rawOf)
}
/** Saved workflows that aren't open, by name. */
export function savedWorkflows(limit = 200): { key: string; name: string }[] {
  const open = new Set(openWorkflows().map((w) => w.path))
  return (store()?.workflows ?? [])
    .map(rawOf)
    .filter((w) => !w.isTemporary && !open.has(w.path))
    .slice(0, limit)
    .map((w) => ({ key: w.path, name: w.path.replace(/^workflows\//, '').replace(/\.json$/i, '') }))
}
/** Find an open or saved workflow by key. */
export function findWorkflow(key: string): ComfyWorkflowLike | undefined {
  const s = store()
  if (!s) return
  const w = s.openWorkflows.find((x) => x.path === key) ?? s.workflows.find((x) => x.path === key)
  return w ? rawOf(w) : undefined
}

/** The layout a workflow's own data carries (`extra.zenkit`), if it is loaded. */
export function storedLayout(w: ComfyWorkflowLike): unknown {
  const state = w.changeTracker?.activeState ?? w.activeState
  return state?.extra?.zenkit
}

// --- running state ---------------------------------------------------------------------------
// ComfyUI doesn't expose which tab a queued run came from, so a run is pinned to the tab that
// was active when it was queued, until the queue empties.
const running = new Set<string>()

// --- tracking --------------------------------------------------------------------------------
let current: ComfyWorkflowLike | null = null
/** A graph load is under way: the canvas may already hold the next workflow while the active
 *  tab is still the previous one, so nothing may be written into it. */
let loading = false
let loadTimer = 0
const listeners = new Set<(prev: ComfyWorkflowLike | null, next: ComfyWorkflowLike) => void>()

const closeListeners = new Set<(w: ComfyWorkflowLike) => void>()

export const isLoadingWorkflow = () => loading

function refresh() {
  const s = store()
  if (!s) return
  const active = activeWorkflow()
  wf.open = s.openWorkflows.map(rawOf).map((w) => ({
    key: w.path,
    name: displayName(w),
    modified: !!w.isModified,
    temporary: !!w.isTemporary,
    active: w === active,
    running: running.has(w.path),
  }))
  wf.current = active?.path ?? null
}

function check() {
  refresh()
  const next = activeWorkflow()
  if (!next || next === current) return
  loading = false
  const prev = current
  current = next
  for (const cb of listeners) cb(prev, next)
}

/** Call `cb` whenever ComfyUI's active workflow tab changes (and once for the first one). */
export function onWorkflowChange(
  cb: (prev: ComfyWorkflowLike | null, next: ComfyWorkflowLike) => void,
): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Call `cb` when a tab is closed (its unsaved state is gone with it). */
export function onWorkflowClosed(cb: (w: ComfyWorkflowLike) => void): () => void {
  closeListeners.add(cb)
  return () => closeListeners.delete(cb)
}

let started = false
let unhook: (() => void) | null = null
/** Start following ComfyUI's workflow tabs. Safe to call before ComfyUI has set up. */
export function startWorkflowTracking(): void {
  if (started) return
  started = true
  const events = api as unknown as EventTarget
  events.addEventListener('graphChanged', () => refresh())
  events.addEventListener('promptQueued', () => {
    const key = activeWorkflow()?.path
    if (key) running.add(key)
    refresh()
  })
  events.addEventListener('status', (e) => {
    const left = (e as CustomEvent<{ exec_info?: { queue_remaining?: number } } | null>).detail
      ?.exec_info?.queue_remaining
    if (left === 0 && running.size) {
      running.clear()
      refresh()
    }
  })
  // A temporary tab's pin goes with the tab; a saved one's stays, so a click reopens it.
  onWorkflowClosed((w) => {
    if (w.isTemporary) pinWorkflow(w.path, false)
  })
  const hookStore = () => {
    const s = store()
    if (unhook || !s?.$onAction) return !!unhook
    unhook = s.$onAction(({ name, args, after }) => {
      // A rename (or the first save of a temporary tab) changes the key: the pin follows it.
      const before = name === 'renameWorkflow' ? (args[0] as ComfyWorkflowLike | null)?.path : null
      after(() => {
        if (before) {
          const now = rawOf(args[0] as ComfyWorkflowLike).path
          if (now !== before && wf.pinned.includes(before))
            setPins(wf.pinned.map((k) => (k === before ? now : k)))
        }
        if (name === 'openWorkflow') check()
        else refresh()
        if (name === 'closeWorkflow' && args[0])
          for (const cb of closeListeners) cb(rawOf(args[0] as ComfyWorkflowLike))
      })
    })
    check()
    return true
  }
  const markLoading = () => {
    loading = true
    clearTimeout(loadTimer)
    // A load that never activates a tab (an undo, a failed load) must not lock writes forever.
    loadTimer = window.setTimeout(() => (loading = false), 4000)
  }
  comfy().registerExtension?.({
    name: 'zenkit.workflowWorkspaces',
    setup: () => hookStore(),
    beforeConfigureGraph: markLoading,
    afterConfigureGraph: () => {
      hookStore()
      // Older frontends set the active tab after this hook, newer ones before `afterLoadGraph`.
      window.setTimeout(check, 0)
    },
    afterLoadGraph: () => {
      loading = false
      check()
    },
  })
  // ComfyUI may already be up (ZenKit installed late), or not yet: try a few times.
  for (const t of [0, 300, 1000, 3000]) window.setTimeout(() => hookStore() && check(), t)
}

/** Call `cb` when ComfyUI notices a change to the graph on screen (a node added, deleted, moved…
 *  — its change tracker's `graphChanged`). */
export function onGraphChanged(cb: () => void): () => void {
  const events = api as unknown as EventTarget
  events.addEventListener('graphChanged', cb)
  return () => events.removeEventListener('graphChanged', cb)
}

/** The ids (as strings) of the nodes in a graph of the workflow on screen — its root graph or one
 *  of its subgraphs — by graph id. Null when it has no such graph (another workflow's, or the root
 *  just cleared for a load, which gives it a fresh id) or while a load is under way. */
export function graphNodeIds(graphId: string): Set<string> | null {
  if (loading) return null
  const root = comfy().rootGraph ?? comfy().graph
  if (!root) return null
  const same = (g: Graph | undefined) => typeof g?.id === 'string' && g.id.toLowerCase() === graphId
  let g: Graph | undefined = same(root) ? root : undefined
  if (!g) {
    try {
      const sub = root.subgraphs?.get?.(graphId)
      g = same(sub) ? sub : undefined
    } catch {
      /* an older frontend without subgraphs */
    }
  }
  const nodes = g?._nodes ?? g?.nodes
  return Array.isArray(nodes) ? new Set(nodes.map((n) => String(n?.id))) : null
}

// --- writing a workflow's extra --------------------------------------------------------------

/** Write `extra.zenkit` into the active workflow's graph and let ComfyUI notice the change
 *  (it marks the tab modified, as any edit does). Null removes it. False when nothing changed or
 *  writing isn't safe right now. */
export function writeActiveExtra(value: unknown): boolean {
  const g = comfy().rootGraph ?? comfy().graph
  const w = activeWorkflow()
  if (!g || !w || loading || w !== current) return false
  const extra = (g.extra ??= {})
  const prev = extra.zenkit
  if (value == null) {
    if (prev === undefined) return false
    delete extra.zenkit
  } else {
    if (JSON.stringify(prev) === JSON.stringify(value)) return false
    extra.zenkit = value
  }
  const t = w.changeTracker
  try {
    if (t?.captureCanvasState) t.captureCanvasState()
    else t?.checkState?.()
  } catch {
    /* the change is in the graph; ComfyUI's next capture picks it up */
  }
  return true
}

// --- switching --------------------------------------------------------------------------------

/** Make a workflow the active tab (opening a saved one), the way ComfyUI's own tabs load it. */
export async function switchToWorkflow(key: string): Promise<boolean> {
  const w = findWorkflow(key)
  if (!w) return false
  if (activeWorkflow() === w) return true
  const loaded = w.isLoaded ? w : rawOf(await w.load())
  await comfy().loadGraphData(loaded.activeState, true, true, loaded)
  check()
  return activeWorkflow() === loaded
}

// --- pins ------------------------------------------------------------------------------------
// A short list of workflow keys in localStorage. A pin whose workflow can't be found (a deleted
// file, a temporary tab from before a reload) simply doesn't show.

function loadPins(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PINS_KEY) ?? '[]')
    return Array.isArray(v)
      ? v.filter((k): k is string => typeof k === 'string' && k.length < 512).slice(0, MAX_PINS)
      : []
  } catch {
    return []
  }
}
function setPins(keys: string[]) {
  wf.pinned = [...new Set(keys)].slice(0, MAX_PINS)
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(wf.pinned))
  } catch {
    /* storage full or blocked: the pins last this session */
  }
}
export const isPinned = (key: string) => wf.pinned.includes(key)
/** Pin or unpin a workflow by key. */
export function pinWorkflow(key: string, pinned: boolean): void {
  if (pinned === isPinned(key)) return
  setPins(pinned ? [...wf.pinned, key] : wf.pinned.filter((k) => k !== key))
}
/** A workflow's tab name by key, open or saved; null when there is no such workflow. */
export function workflowLabel(key: string): string | null {
  const open = wf.open.find((e) => e.key === key)
  if (open) return open.name
  const w = findWorkflow(key)
  return w ? displayName(w) : null
}

// --- public API ------------------------------------------------------------------------------

/** `zen.workflows`: the open tabs as ZenKit sees them. */
export function workflowsApi(): ZenKitApi['workflows'] {
  const copy = (e: WorkflowEntry): WorkflowInfo => ({ ...e })
  const current = () => {
    const e = wf.open.find((x) => x.active)
    return e ? copy(e) : null
  }
  return {
    current,
    list: () => wf.open.map(copy),
    open: (key) => switchToWorkflow(String(key)),
    pinned: () => [...wf.pinned],
    pin: (key, pinned) => pinWorkflow(String(key), !!pinned),
    onChange: (cb) =>
      watch(
        () =>
          wf.open.map((e) => `${e.key}:${+e.active}${+e.modified}${+e.running}`).join('|') +
          `#${wf.pinned.join('|')}`,
        () => cb(current()),
      ),
  }
}
