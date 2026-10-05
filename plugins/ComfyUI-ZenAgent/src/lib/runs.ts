import { api } from '@comfy/api'
import { app } from '@comfy/app'
import { mediaKindOf } from '@nynxz/zenkit-client'
import { reactive } from 'vue'

// Runs the agent queues, followed through ComfyUI's execution events (all keyed by
// prompt_id) so the chat can draw a live run card and the model learns how the run went.

export interface RunOutput {
  /** Its media ref (zen.media), e.g. output/ComfyUI_00012_.png. */
  ref: string
  node: string
  filename: string
  subfolder: string
  type: string
  url: string
  kind: 'image' | 'video' | 'audio'
}

export interface Run {
  promptId: string
  status: 'queued' | 'running' | 'done' | 'error' | 'interrupted'
  /** Progress of the node currently sampling, when it reports any. */
  progress: { value: number; max: number } | null
  node: string | null
  outputs: RunOutput[]
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export const runs = reactive<Record<string, Run>>({})

interface PromptData {
  prompt_id?: string
  node?: string
  value?: number
  max?: number
  output?: Record<string, { filename: string; subfolder?: string; type?: string }[] | undefined>
  exception_message?: string
  node_type?: string
}

function nodeTitle(id: string | undefined): string | null {
  if (!id) return null
  const node = (app.graph as { getNodeById(id: number): { title?: string; type?: string } | null })
    .getNodeById(Number(id))
  return node?.title ?? node?.type ?? `#${id}`
}

function viewUrl(file: { filename: string; subfolder?: string; type?: string }): string {
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' })
  return api.apiURL(`/view?${q.toString()}`)
}

const finished = new Map<string, (run: Run) => void>()
const handlers = new Map<string, (run: Run, data: PromptData) => void>()

// A fast run can finish before the response to its /prompt request arrives, so events for a
// prompt id not registered yet are held briefly and replayed when it is.
const early = new Map<string, { type: string; data: PromptData }[]>()
const EARLY_LIMIT = 64

function on(type: string, handle: (run: Run, data: PromptData) => void): void {
  handlers.set(type, handle)
  api.addEventListener(type, (e: Event) => {
    const data = (e as CustomEvent<PromptData>).detail
    const id = data?.prompt_id
    if (!id) return
    const run = runs[id]
    if (run) return handle(run, data)
    const held = early.get(id) ?? []
    held.push({ type, data })
    early.set(id, held)
    if (early.size > EARLY_LIMIT) early.delete(early.keys().next().value!)
  })
}

function replayEarly(run: Run): void {
  for (const { type, data } of early.get(run.promptId) ?? []) handlers.get(type)?.(run, data)
  early.delete(run.promptId)
}

function finish(run: Run, status: Run['status'], error: string | null = null): void {
  if (run.finishedAt !== null) return
  run.status = status
  run.error = error
  run.progress = null
  run.node = null
  run.finishedAt = Date.now()
  finished.get(run.promptId)?.(run)
  finished.delete(run.promptId)
}

on('execution_start', (run) => (run.status = 'running'))
on('progress', (run, d) => {
  run.status = 'running'
  run.progress = { value: d.value ?? 0, max: d.max ?? 0 }
  run.node = nodeTitle(d.node)
})
type NodeOutput = PromptData['output']

function addOutputs(run: Run, node: string, output: NodeOutput): void {
  for (const files of Object.values(output ?? {})) {
    for (const file of files ?? []) {
      if (!file?.filename) continue
      const kind = mediaKindOf(file.filename)
      run.outputs.push({ ref: [file.type ?? 'output', file.subfolder, file.filename].filter(Boolean).join('/'), node, filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output', url: viewUrl(file), kind })
    }
  }
}

on('executed', (run, d) => addOutputs(run, d.node ?? '', d.output))
on('execution_success', (run) => finish(run, 'done'))
on('execution_error', (run, d) =>
  finish(run, 'error', `${d.node_type ?? 'A node'} failed: ${d.exception_message ?? 'unknown error'}`.trim()),
)
on('execution_interrupted', (run) => finish(run, 'interrupted', 'The run was interrupted.'))

/** A widget value changed for one run only; the graph itself is left as it is. */
export interface Override {
  node_id: number | string
  widget: string
  value: unknown
}

type ApiPrompt = Record<string, { class_type: string; inputs: Record<string, unknown> } | undefined>

function applyOverrides(output: ApiPrompt, overrides: Override[]): void {
  for (const { node_id, widget, value } of overrides) {
    const node = output[String(node_id)]
    if (!node) throw new Error(`Node ${String(node_id)} is not part of the queued workflow.`)
    if (!(widget in node.inputs)) throw new Error(`${node.class_type} #${String(node_id)} has no input "${widget}".`)
    if (Array.isArray(node.inputs[widget])) throw new Error(`"${widget}" on #${String(node_id)} is fed by a link, not a widget.`)
    node.inputs[widget] = value
  }
}

/** Queue the current workflow (with any per-run overrides); returns its prompt id once queued. */
export async function queueRun(onQueued: (promptId: string) => void, overrides: Override[] = []): Promise<string> {
  const prompt = await (app as { graphToPrompt(): Promise<{ output: ApiPrompt; workflow: unknown }> }).graphToPrompt()
  applyOverrides(prompt.output, overrides)
  const res = await (
    api as { queuePrompt(n: number, p: unknown): Promise<{ prompt_id?: string; error?: unknown }> }
  ).queuePrompt(0, prompt)
  if (!res.prompt_id) throw new Error(`The workflow was not queued: ${JSON.stringify(res.error ?? res)}`)
  const run: Run = {
    promptId: res.prompt_id,
    status: 'queued',
    progress: null,
    node: null,
    outputs: [],
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  }
  runs[run.promptId] = run
  onQueued(run.promptId)
  replayEarly(runs[run.promptId]!)
  return run.promptId
}

/** Resolves once the run has finished, failed or been interrupted. */
export function waitForRun(promptId: string): Promise<Run> {
  const run = runs[promptId]
  if (!run) return Promise.reject(new Error(`No run with prompt id ${promptId}.`))
  if (run.finishedAt !== null) return Promise.resolve(run)
  return new Promise((resolve) => {
    const previous = finished.get(promptId)
    finished.set(promptId, (done) => {
      previous?.(done)
      resolve(done)
    })
  })
}

interface HistoryEntry {
  status?: { status_str?: string; messages?: [string, { timestamp?: number }][] }
  outputs?: Record<string, NodeOutput>
}

/** Rebuild a finished run from the server's history, for a thread reopened after a reload. */
export async function restoreRun(promptId: string): Promise<Run | null> {
  if (runs[promptId]) return runs[promptId]
  const res = await api.fetchApi(`/history/${encodeURIComponent(promptId)}`)
  const entry = res.ok ? ((await res.json()) as Record<string, HistoryEntry>)[promptId] : undefined
  if (!entry) return null
  const times = (entry.status?.messages ?? []).map(([, m]) => m.timestamp ?? 0).filter(Boolean)
  const run: Run = {
    promptId,
    status: entry.status?.status_str === 'error' ? 'error' : 'done',
    progress: null,
    node: null,
    outputs: [],
    error: null,
    startedAt: times.length ? Math.min(...times) : Date.now(),
    finishedAt: times.length ? Math.max(...times) : Date.now(),
  }
  for (const [node, output] of Object.entries(entry.outputs ?? {})) addOutputs(run, node, output)
  runs[promptId] = run
  return runs[promptId]!
}
