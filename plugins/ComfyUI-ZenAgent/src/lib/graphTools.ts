import { api } from '@comfy/api'
import { app } from '@comfy/app'
import { getZenKit } from '@nynxz/zenkit-client'

import type { ToolResult } from './api'
import { capabilityFor } from './capabilityTools'
import { renderSchematic } from './schematic'
import type { LayoutGraph } from './layout'
import { boxOf, forget, parkNew, pin, resolveOverlaps, settleAll, sizeOf, tidy, unplaced } from './layout'
import { resolveMedia, snapshot } from './vision'
import type { Override, Run } from './runs'
import { queueRun, runs, waitForRun } from './runs'

// The model's tools, run against the live graph in this browser (the backend only relays
// them; see zenagent/tools.py for what the model is told each one does).

interface Slot {
  name: string
  type: string
  link?: number | null
  links?: number[] | null
  widget?: { name: string }
}
interface Widget {
  name: string
  value: unknown
  options?: { values?: unknown[] | (() => unknown[]) }
  callback?: (value: unknown) => void
}
interface GraphNode {
  id: number
  type: string
  title: string
  pos: [number, number]
  size: [number, number]
  inputs?: Slot[]
  outputs?: Slot[]
  widgets?: Widget[]
  connect(outputSlot: number, target: GraphNode, inputSlot: number): unknown
  disconnectInput(slot: number): void
}
interface LinkInfo {
  origin_id: number
  origin_slot: number
  target_id: number
  target_slot: number
}
interface Graph {
  nodes?: GraphNode[]
  _nodes?: GraphNode[]
  links: Record<number, LinkInfo> | Map<number, LinkInfo>
  getNodeById(id: number): GraphNode | null
  add(node: GraphNode): void
  remove(node: GraphNode): void
  setDirtyCanvas(fg: boolean, bg: boolean): void
}
interface NodeDef {
  name: string
  display_name?: string
  category?: string
  description?: string
  input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> }
  output?: string[]
  output_name?: string[]
}

const graph = (): Graph => app.graph as Graph
const view: LayoutGraph = {
  nodes: () => nodes(),
  byId: (id) => graph().getNodeById(id),
  link: (id) => link(id),
}
const nodes = (): GraphNode[] => graph().nodes ?? graph()._nodes ?? []
const lower = (s: unknown) => String(s ?? '').toLowerCase()

function link(id: number) {
  const links = graph().links
  return links instanceof Map ? links.get(id) : links[id]
}

function nodeOrThrow(id: unknown): GraphNode {
  const node = graph().getNodeById(Number(id))
  if (!node) throw new Error(`No node with id ${String(id)}. Call read_workflow for current ids.`)
  return node
}

function comboValues(widget: Widget): unknown[] | null {
  const values = widget.options?.values
  if (!values) return null
  return typeof values === 'function' ? values() : values
}

/** How a node reads to a person: its title, or type when it has none. */
export function nodeLabel(node: GraphNode): string {
  return node.title && node.title !== node.type ? `${node.title} (${node.type})` : node.type
}

function setWidget(node: GraphNode, name: string, value: unknown): unknown {
  const widget = node.widgets?.find((w) => w.name === name)
  if (!widget) {
    const names = node.widgets?.map((w) => w.name).join(', ') || 'none'
    throw new Error(`${node.type} #${node.id} has no widget "${name}". Its widgets: ${names}.`)
  }
  const options = comboValues(widget)
  if (options && !options.includes(value)) {
    const shown = options.slice(0, 30).map(String).join(', ')
    throw new Error(`"${String(value)}" is not an option for ${name}. Options: ${shown}${options.length > 30 ? ', …' : ''}`)
  }
  const previous = widget.value
  widget.value = value
  widget.callback?.(value)
  return previous
}

const round = (n: number) => Math.round(n)

const GAP = 20 // clearance between boxes that still reads as overlapping

function describe(node: GraphNode) {
  return {
    id: node.id,
    type: node.type,
    ...(node.title !== node.type ? { title: node.title } : {}),
    pos: [round(node.pos[0]), round(node.pos[1])],
    size: sizeOf(node).map(round),
    widgets: Object.fromEntries((node.widgets ?? []).map((w) => [w.name, w.value])),
    inputs: (node.inputs ?? []).map((input) => {
      const from = input.link != null ? link(input.link) : undefined
      const source = from ? graph().getNodeById(from.origin_id) : null
      return {
        name: input.name,
        type: input.type,
        ...(source ? { from: { node: source.id, output: source.outputs?.[from!.origin_slot]?.name } } : {}),
      }
    }),
    outputs: (node.outputs ?? []).map((o) => ({ name: o.name, type: o.type })),
  }
}

let nodeDefs: Record<string, NodeDef> | null = null

interface Canvas {
  centerOnNode?(node: GraphNode): void
  selectNode?(node: GraphNode): void
  setDirty(fg: boolean, bg: boolean): void
}

/** Bring a node into view on the canvas and select it. */
export function focusNode(id: number): boolean {
  const node = graph().getNodeById(id)
  const canvas = (app as { canvas?: Canvas }).canvas
  if (!node || !canvas) return false
  canvas.centerOnNode?.(node)
  canvas.selectNode?.(node)
  canvas.setDirty(true, true)
  return true
}

export interface ToolHooks {
  /** A run the agent queued, so the chat can follow it live. */
  onRun(promptId: string): void
}

const TOOLS: Record<
  string,
  (args: Record<string, unknown>, hooks: ToolHooks) => Promise<unknown> | unknown
> = {
  read_workflow: () => ({
    workflow: (app as { extensionManager?: { workflow?: { activeWorkflow?: { filename?: string } } } }).extensionManager
      ?.workflow?.activeWorkflow?.filename,
    nodes: nodes().map(describe),
  }),

  async find_node_types({ query }) {
    nodeDefs ??= (await (api as { getNodeDefs(): Promise<Record<string, NodeDef>> }).getNodeDefs())
    const words = lower(query).split(/\s+/).filter(Boolean)
    const scored = Object.values(nodeDefs)
      .map((def) => {
        const hay = `${lower(def.name)} ${lower(def.display_name)} ${lower(def.category)}`
        return { def, score: words.filter((w) => hay.includes(w)).length }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
    return scored.map(({ def }) => ({
      type: def.name,
      name: def.display_name,
      category: def.category,
      inputs: Object.entries({ ...def.input?.required, ...def.input?.optional }).map(
        ([name, spec]) => `${name}: ${Array.isArray(spec[0]) ? 'COMBO' : String(spec[0])}`,
      ),
      outputs: (def.output ?? []).map((type, i) => `${def.output_name?.[i] ?? type}: ${type}`),
    }))
  },

  add_node({ type, widgets }) {
    const LiteGraph = (window as unknown as { LiteGraph: { createNode(t: string): GraphNode | null } }).LiteGraph
    const node = LiteGraph.createNode(String(type))
    if (!node) throw new Error(`Unknown node type "${String(type)}". Use find_node_types to look it up.`)
    graph().add(node)
    parkNew(node, view)
    added.add(node.id)
    addedThisTurn.add(node.id)
    // A bad widget value fails the whole call, so the graph is left as it was.
    try {
      for (const [name, value] of Object.entries((widgets as Record<string, unknown>) ?? {}))
        setWidget(node, name, value)
    } catch (error) {
      graph().remove(node)
      throw error
    }
    return { id: node.id, type: node.type }
  },

  set_widget({ node_id, name, value }) {
    const node = nodeOrThrow(node_id)
    const from = setWidget(node, String(name), value)
    return { node: nodeLabel(node), name, from, to: value }
  },

  connect({ from_node, output, to_node, input }) {
    const source = nodeOrThrow(from_node)
    const target = nodeOrThrow(to_node)
    const outIndex = (source.outputs ?? []).findIndex(
      (o) => lower(o.name) === lower(output) || lower(o.type) === lower(output),
    )
    if (outIndex === -1)
      throw new Error(`${source.type} #${source.id} has no output "${String(output)}". Outputs: ${(source.outputs ?? []).map((o) => o.name).join(', ')}.`)
    const inIndex = (target.inputs ?? []).findIndex((i) => lower(i.name) === lower(input))
    if (inIndex === -1)
      throw new Error(`${target.type} #${target.id} has no input "${String(input)}". Inputs: ${(target.inputs ?? []).map((i) => i.name).join(', ')}.`)
    const previous = target.inputs![inIndex]!.link
    const replaced = previous != null ? graph().getNodeById(link(previous)?.origin_id ?? -1) : null
    if (!source.connect(outIndex, target, inIndex))
      throw new Error(`Could not connect ${source.outputs![outIndex].type} to ${target.inputs![inIndex].type}.`)
    const made = target.inputs![inIndex]!.link
    if (made != null) linksThisTurn.add(made)
    return { from: nodeLabel(source), to: nodeLabel(target), ...(replaced && replaced !== source ? { replaced: nodeLabel(replaced) } : {}) }
  },

  disconnect({ node_id, input }) {
    const node = nodeOrThrow(node_id)
    const index = (node.inputs ?? []).findIndex((i) => lower(i.name) === lower(input))
    if (index === -1) throw new Error(`${node.type} #${node.id} has no input "${String(input)}".`)
    const current = node.inputs![index]!.link
    if (current != null && linksThisTurn.has(current))
      throw new Error(
        `You connected ${String(input)} on #${node.id} yourself just now, and that already replaced its old link. ` +
          'Nothing was disconnected; leave it connected.',
      )
    node.disconnectInput(index)
    return { ok: true }
  },

  move_node({ node_id, x, y }) {
    const node = nodeOrThrow(node_id)
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) throw new Error('x and y must be numbers.')
    node.pos = [Number(x), Number(y)]
    pin(node.id)
    return { moved: nodeLabel(node), pos: [round(node.pos[0]), round(node.pos[1])] }
  },

  check_layout() {
    settleAll(view)
    const all = nodes()
    const boxes = all.map((node) => ({ node, ...boxOf(node) }))
    const overlaps: { a: number; b: number; overlap: [number, number]; move_b_right_by: number; move_b_down_by: number }[] = []
    let others = 0
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const b = boxes[j]!
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + GAP
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + GAP
        if (ox > 0 && oy > 0 && !added.has(a.node.id) && !added.has(b.node.id)) others++
        else if (ox > 0 && oy > 0)
          overlaps.push({
            a: a.node.id,
            b: b.node.id,
            overlap: [round(ox), round(oy)],
            move_b_right_by: round(a.x + a.w + GAP - b.x),
            move_b_down_by: round(a.y + a.h + GAP - b.y),
          })
      }
    }
    const xs = boxes.flatMap((b) => [b.x, b.x + b.w])
    const ys = boxes.flatMap((b) => [b.y, b.y + b.h])
    return {
      nodes: all.length,
      bounds: all.length ? [round(Math.min(...xs)), round(Math.min(...ys)), round(Math.max(...xs)), round(Math.max(...ys))] : null,
      overlaps,
      ...(unplaced().length ? { added_but_unconnected: unplaced() } : {}),
      ...(others ? { user_overlaps: `${others} overlap(s) between the user's own nodes; leave those unless asked to tidy.` } : {}),
    }
  },

  resize_node({ node_id, width, height, fit }) {
    const node = nodeOrThrow(node_id) as GraphNode & { computeSize?(): [number, number]; setSize?(s: [number, number]): void }
    const min = node.computeSize?.() ?? [80, 40]
    const [w, h] =
      fit === true
        ? min
        : [Number.isFinite(Number(width)) ? Number(width) : node.size[0], Number.isFinite(Number(height)) ? Number(height) : node.size[1]]
    const next: [number, number] = [Math.max(min[0], w), Math.max(min[1], h)]
    if (node.setSize) node.setSize(next)
    else node.size = next
    const moved = resolveOverlaps([node.id], view) > 0
    return { node: nodeLabel(node), size: sizeOf(node).map(round), ...(moved ? { moved_to: node.pos.map(round) } : {}), ...(next[0] > w || next[1] > h ? { note: `Kept at least its minimum size ${min.map(round).join('×')}.` } : {}) }
  },

  view_layout({ node_ids }) {
    settleAll(view)
    const only = Array.isArray(node_ids) && node_ids.length ? new Set(node_ids.map(Number)) : undefined
    const { image, bounds } = renderSchematic(view, added, only)
    return {
      nodes: (only ? [...only] : nodes().map((n) => n.id)).length,
      bounds,
      note: 'Boxes are nodes (#id title), red boxes overlap, blue outlines are nodes you added; gridlines are canvas coordinates for move_node.',
      images: [image],
    }
  },

  tidy_layout({ node_ids }) {
    const only = Array.isArray(node_ids) && node_ids.length ? new Set(node_ids.map(Number)) : undefined
    return { arranged: tidy(view, only) }
  },

  remove_node({ node_id, force }) {
    const node = nodeOrThrow(node_id)
    const feeds = (node.outputs ?? [])
      .flatMap((o) => o.links ?? [])
      .map((id) => link(id))
      .map((l) => (l ? graph().getNodeById((l as LinkInfo).target_id) : null))
      .filter((n): n is GraphNode => !!n)
    if (feeds.length && !added.has(node.id) && force !== true)
      throw new Error(
        `${nodeLabel(node)} still feeds ${[...new Set(feeds.map(nodeLabel))].join(', ')}; removing it would break the workflow. ` +
          'Nothing was removed. Only if the user asked for it, call again with force=true.',
      )
    graph().remove(node)
    forget(node.id)
    return { removed: nodeLabel(node) }
  },

  async queue_prompt({ variations, wait = true }, hooks) {
    const list = variationsFrom(variations)
    const queued: string[] = []
    for (const overrides of list) queued.push(await queueRun(hooks.onRun, overrides))
    if (!wait) return { queued: queued.map((prompt_id) => ({ prompt_id, status: 'queued' })) }
    const done = await Promise.all(queued.map(waitForRun))
    return done.length === 1 ? runSummary(done[0]!) : { runs: done.map(runSummary) }
  },

  async wait_for_runs({ prompt_ids }) {
    const ids = Array.isArray(prompt_ids) && prompt_ids.length ? prompt_ids.map(String) : pendingRuns()
    if (!ids.length) throw new Error('There are no runs to wait for.')
    return { runs: (await Promise.all(ids.map(waitForRun))).map(runSummary) }
  },

  async look_at({ media }) {
    const refs = (Array.isArray(media) ? media : [media]).filter((m): m is string => typeof m === 'string').slice(0, 4)
    if (!refs.length) throw new Error('Give the media refs to look at.')
    const images = await Promise.all(refs.map(async (ref) => snapshot(await resolveMedia(ref))))
    return { seen: refs, images }
  },

  async use_as_input({ media, node_id, widget }) {
    const node = nodeOrThrow(node_id)
    const files = (node.widgets ?? []).filter((w) => Array.isArray(w.options?.values) || typeof w.options?.values === 'function')
    const target = widget ? node.widgets?.find((w) => w.name === widget) : (files.find((w) => FILE_WIDGET.test(w.name)) ?? files[0])
    if (!target) throw new Error(`${nodeLabel(node)} has no file widget${widget ? ` "${String(widget)}"` : ''}.`)
    const value = await zenKit().media.toInput(String(media))
    const from = target.value
    target.value = value
    target.callback?.(value)
    return { node: nodeLabel(node), widget: target.name, from, to: value }
  },
}

// Nodes the agent added: layout checks are about these, not the user's own arrangement.
const added = new Set<number>()

// Links the agent made during the current reply, which a disconnect must not undo by mistake.
const linksThisTurn = new Set<number>()

/** A new reply is starting. */
export function beginTurn(): void {
  linksThisTurn.clear()
}

// Nodes added in the current reply, checked again once their previews have loaded.
const addedThisTurn = new Set<number>()

/** The reply is done: put the nodes it added in place, then once more after their previews have
 *  had time to load and grow them; each change is an undo step. */
export function endTurn(): void {
  const fresh = [...addedThisTurn]
  addedThisTurn.clear()
  if (settleAll(view)) {
    graph().setDirtyCanvas(true, true)
    checkpoint()
  }
  for (const delay of [600, 2000])
    window.setTimeout(() => {
      if (!resolveOverlaps(fresh, view)) return
      graph().setDirtyCanvas(true, true)
      checkpoint()
    }, delay)
}

const FILE_WIDGET = /^(image|video|audio|file|upload)$/

function zenKit() {
  const zen = getZenKit()
  if (!zen) throw new Error('ZenKit is not available.')
  return zen
}

const isOverride = (v: unknown): v is Override =>
  typeof v === 'object' && v !== null && 'node_id' in v && 'widget' in v && 'value' in v

/** One variation as overrides: a list of {node_id, widget, value}, a single one, or a map of
 *  "node_id.widget" to value. An empty one runs the workflow as it is. */
function overridesFrom(variation: unknown, index: number): Override[] {
  if (Array.isArray(variation)) {
    const bad = variation.findIndex((o) => !isOverride(o))
    if (bad !== -1) throw new Error(`Variation ${index + 1}, item ${bad + 1} needs node_id, widget and value.`)
    return variation as Override[]
  }
  if (isOverride(variation)) return [variation]
  if (typeof variation === 'object' && variation !== null)
    return Object.entries(variation).map(([key, value]) => {
      const [nodeId, widget] = key.split('.')
      if (!nodeId || !widget) throw new Error(`Variation ${index + 1}: use "node_id.widget" keys, e.g. "6.text".`)
      return { node_id: nodeId, widget, value }
    })
  throw new Error(`Variation ${index + 1} is not a list of changes.`)
}

function variationsFrom(variations: unknown): Override[][] {
  if (!Array.isArray(variations) || !variations.length) return [[]]
  const list = variations.map(overridesFrom)
  const keys = list.map((overrides) => JSON.stringify(overrides.map((o) => [String(o.node_id), o.widget, o.value]).sort()))
  const twin = keys.findIndex((key, i) => keys.indexOf(key) !== i)
  if (twin !== -1)
    throw new Error(
      `Variations ${keys.indexOf(keys[twin]!) + 1} and ${twin + 1} are identical, so they would make the same image. ` +
        'Give each one different widget values (e.g. a different seed or prompt). Nothing was queued.',
    )
  return list
}

function runSummary(run: Run) {
  return {
    prompt_id: run.promptId,
    status: run.status,
    ...(run.error ? { error: run.error } : {}),
    seconds: Math.round(((run.finishedAt ?? Date.now()) - run.startedAt) / 100) / 10,
    outputs: run.outputs.map((o) => ({ media: o.ref, node_id: Number(o.node) })),
  }
}

const pendingRuns = () => Object.values(runs).filter((r) => r.finishedAt === null).map((r) => r.promptId)

const EDITS = new Set(['add_node', 'set_widget', 'connect', 'disconnect', 'remove_node', 'move_node', 'resize_node', 'use_as_input', 'tidy_layout'])

interface ChangeTracker {
  captureCanvasState?(): void
  checkState?(): void
}

/** Record an edit in ComfyUI's undo history, so Ctrl+Z undoes what the agent did. */
function checkpoint(): void {
  const tracker = (
    app as {
      extensionManager?: { workflow?: { activeWorkflow?: { changeTracker?: ChangeTracker } } }
    }
  ).extensionManager?.workflow?.activeWorkflow?.changeTracker
  if (tracker?.captureCanvasState) tracker.captureCanvasState()
  else tracker?.checkState?.()
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  hooks: ToolHooks,
): Promise<ToolResult> {
  const capability = TOOLS[name] ? undefined : capabilityFor(name)
  const tool = TOOLS[name] ?? (capability ? () => zenKit().capabilities.run(capability, args) : undefined)
  if (!tool) return { ok: false, error: `Unknown tool "${name}".` }
  try {
    const result = await tool(args, hooks)
    graph().setDirtyCanvas(true, true)
    if (EDITS.has(name)) checkpoint()
    return { ok: true, result }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
