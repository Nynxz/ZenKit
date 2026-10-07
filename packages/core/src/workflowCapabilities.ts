// Workflow capabilities: see the open tabs and saved workflows, switch between them, and open
// new ones (blank or from ComfyUI's template gallery), so work can move from one workflow to
// the next (generate in one, edit the result in another). Graph edits and runs act on the
// active tab, so whatever switches tabs here changes what those see.
import { api } from '@comfy/api'
import { app } from '@comfy/app'

import type { ZenKitApi } from './types'

interface Workflow {
  path: string
  filename: string
  isTemporary: boolean
  isModified: boolean
  isLoaded: boolean
  activeState: unknown
  load(): Promise<Workflow>
}
interface WorkflowStore {
  activeWorkflow: Workflow | null
  openWorkflows: Workflow[]
  workflows: Workflow[]
}
interface ComfyApp {
  extensionManager: { workflow: WorkflowStore }
  graph: { nodes?: unknown[]; _nodes?: unknown[] }
  loadGraphData(
    data: unknown,
    clean?: boolean,
    restoreView?: boolean,
    workflow?: Workflow | string,
  ): Promise<unknown>
}

interface Template {
  name: string
  title?: string
  description?: string
  mediaType?: string
  tags?: string[]
  models?: string[]
}
interface TemplateGroup {
  moduleName: string
  title?: string
  templates: Template[]
}

const comfy = () => app as ComfyApp
const store = () => comfy().extensionManager.workflow
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const plain = (name: string) => name.replace(/\.json$/i, '').toLowerCase()

const BLANK = {
  last_node_id: 0,
  last_link_id: 0,
  nodes: [],
  links: [],
  groups: [],
  config: {},
  extra: {},
  version: 0.4,
}

function summary(w: Workflow) {
  const active = store().activeWorkflow
  return {
    workflow: w.filename,
    path: w.path,
    ...(active?.path === w.path ? { active: true } : {}),
    ...(w.isModified ? { modified: true } : {}),
    ...(w.isTemporary ? { unsaved: true } : {}),
  }
}

/** An open tab first, then a saved workflow, matched by path or by name (with or without .json). */
function findWorkflow(name: string): Workflow | undefined {
  const target = plain(name)
  const matches = (w: Workflow) =>
    w.path === name || plain(w.filename) === target || plain(w.path) === target
  return store().openWorkflows.find(matches) ?? store().workflows.find(matches)
}

function activeInfo() {
  const g = comfy().graph
  return {
    active: store().activeWorkflow?.filename ?? null,
    nodes: (g.nodes ?? g._nodes ?? []).length,
  }
}

/** A tab name no other workflow uses, so opening never lands on an existing one. */
function freshName(name: string): string {
  const taken = new Set(store().workflows.map((w) => plain(w.filename)))
  let candidate = name.replace(/\.json$/i, '')
  for (let n = 2; taken.has(candidate.toLowerCase()); n++)
    candidate = `${name.replace(/\.json$/i, '')} (${n})`
  return candidate
}

let templates: Promise<TemplateGroup[]> | null = null
function templateIndex(): Promise<TemplateGroup[]> {
  templates ??= fetch(api.fileURL('/templates/index.json')).then((r) => {
    if (!r.ok) throw new Error(`Could not load the template list (${r.status}).`)
    return r.json() as Promise<TemplateGroup[]>
  })
  templates.catch(() => (templates = null))
  return templates
}

export function registerWorkflowCapabilities(zen: ZenKitApi): void {
  const { register } = zen.capabilities

  register({
    id: 'workflows.list',
    effect: 'read',
    description:
      "The workflow tabs open now (which one is active, unsaved changes) and the user's saved workflows. Graph " +
      'tools and runs act on the active tab.',
    params: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Only saved workflows whose name contains this.' },
      },
    },
    run: ({ query }) => {
      const needle = str(query)?.toLowerCase()
      const saved = store()
        .workflows.filter((w) => !w.isTemporary)
        .filter((w) => !needle || w.path.toLowerCase().includes(needle))
      return {
        open: store().openWorkflows.map(summary),
        saved: saved.slice(0, 50).map((w) => w.path.replace(/^workflows\//, '')),
        saved_total: saved.length,
      }
    },
  })

  register({
    id: 'workflows.open',
    effect: 'write',
    description:
      'Switch to an open workflow tab, or open a saved workflow, by name or path (from workflows.list). It ' +
      'becomes the active tab; read the workflow again before editing it, since node ids differ per workflow.',
    params: {
      type: 'object',
      properties: { workflow: { type: 'string' } },
      required: ['workflow'],
    },
    run: async ({ workflow }) => {
      const found = findWorkflow(String(workflow))
      if (!found)
        throw new Error(`No workflow "${String(workflow)}". workflows.list shows the names.`)
      if (store().activeWorkflow?.path !== found.path) {
        const loaded = found.isLoaded ? found : await found.load()
        await comfy().loadGraphData(loaded.activeState, true, true, loaded)
      }
      return activeInfo()
    },
  })

  register({
    id: 'workflows.new',
    effect: 'write',
    description: 'Open a new, empty workflow tab and make it active.',
    params: { type: 'object', properties: { name: { type: 'string' } } },
    run: async ({ name }) => {
      await comfy().loadGraphData(
        structuredClone(BLANK),
        true,
        true,
        freshName(str(name) ?? 'Untitled'),
      )
      return activeInfo()
    },
  })

  register({
    id: 'workflows.templates',
    effect: 'read',
    description:
      "Search ComfyUI's template gallery (ready-made workflows such as text to image, image edit, upscale, video). " +
      'Returns template names for workflows.open_template, with the models each one needs.',
    params: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Words to match in the title, description or tags, e.g. "image edit".',
        },
        media: { type: 'string', enum: ['image', 'video', 'audio', '3d'] },
        limit: { type: 'number', description: 'Default 8.' },
      },
    },
    run: async ({ query, media, limit }) => {
      const words = (str(query)?.toLowerCase() ?? '').split(/\s+/).filter(Boolean)
      const all = (await templateIndex()).flatMap((group) =>
        group.templates.map((t) => ({ ...t, group: group.title })),
      )
      const scored = all
        .filter((t) => !media || t.mediaType === media)
        .map((t) => {
          const text = [t.name, t.title, t.description, ...(t.tags ?? []), t.group]
            .join(' ')
            .toLowerCase()
          const phrase = words.join(' ')
          const named = [t.title, ...(t.tags ?? [])].join(' ').toLowerCase()
          return {
            t,
            score:
              words.filter((w) => text.includes(w)).length +
              (phrase && named.includes(phrase) ? words.length : 0),
          }
        })
        .filter((x) => !words.length || x.score > 0)
        .sort((a, b) => b.score - a.score)
      const count = Math.max(1, Math.min(30, typeof limit === 'number' ? limit : 8))
      return {
        total: scored.length,
        templates: scored.slice(0, count).map(({ t }) => ({
          template: t.name,
          title: t.title,
          description: t.description?.slice(0, 200),
          tags: t.tags,
          models: t.models,
        })),
      }
    },
  })

  register({
    id: 'workflows.open_template',
    effect: 'write',
    description:
      'Open a template from workflows.templates as a new workflow tab and make it active.',
    params: {
      type: 'object',
      properties: { template: { type: 'string' }, name: { type: 'string' } },
      required: ['template'],
    },
    run: async ({ template, name }) => {
      const group = (await templateIndex()).find((g) =>
        g.templates.some((t) => t.name === template),
      )
      if (!group)
        throw new Error(`No template "${String(template)}". workflows.templates finds them.`)
      const entry = group.templates.find((t) => t.name === template)!
      const url =
        group.moduleName === 'default'
          ? api.fileURL(`/templates/${entry.name}.json`)
          : api.apiURL(`/workflow_templates/${group.moduleName}/${entry.name}.json`)
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Could not load template "${entry.name}" (${res.status}).`)
      await comfy().loadGraphData(
        await res.json(),
        true,
        true,
        freshName(str(name) ?? entry.title ?? entry.name),
      )
      return { ...activeInfo(), models: entry.models }
    },
  })
}
