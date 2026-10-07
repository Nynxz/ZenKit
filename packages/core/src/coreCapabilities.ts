// The capabilities ZenKit itself offers: seeing and arranging panels, and showing media.
import { api } from '@comfy/api'

import { kindOf } from './media'
import type { DockSide, ZenKitApi } from './types'

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

function openHandle(zen: ZenKitApi, id: unknown) {
  const handle = zen.panels.get(String(id))
  if (!handle?.getRect())
    throw new Error(`No open panel "${String(id)}". panels.list shows the open ones.`)
  return handle
}

// A panel that has just opened (or been restored) mounts a frame or two later, so its
// commands are retried briefly before giving up.
async function runPanelCommand(
  zen: ZenKitApi,
  id: unknown,
  command: string,
  args: Record<string, unknown>,
) {
  const handle = openHandle(zen, id)
  for (let attempt = 0; ; attempt++) {
    if (handle.commands().some((c) => c.name === command) || attempt >= 30)
      return handle.run(command, args)
    if (attempt === 0) handle.restore()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function registerCoreCapabilities(zen: ZenKitApi): void {
  const { register } = zen.capabilities

  register({
    id: 'panels.list',
    effect: 'read',
    description:
      "List the panel types that can be opened and the panels open right now: each open panel's panel_id, " +
      'title, position/size, its own summary of what it shows (`state`) and the `commands` it accepts.',
    run: () => {
      const open = new Set(zen.panels.list())
      return zen.panels
        .registered()
        .filter((type) => type.id !== 'zenkit:settings')
        .map((type) => ({
          type: type.id,
          title: type.title,
          multi: !!type.multi,
          open: zen.panels
            .instances(type.id)
            .filter((i) => open.has(i.id))
            .map((i) => {
              const handle = zen.panels.get(i.id)!
              return {
                panel_id: i.id,
                title: i.title,
                rect: handle.getRect(),
                state: handle.describe(),
                commands: handle.commands(),
              }
            }),
        }))
    },
  })

  register({
    id: 'panels.open',
    effect: 'write',
    description:
      'Open a panel of a type from panels.list (a new one for multi types). Returns its panel_id.',
    params: {
      type: 'object',
      properties: { type: { type: 'string' }, title: { type: 'string' } },
      required: ['type'],
    },
    run: ({ type, title }) => {
      const registered = zen.panels.registered().some((p) => p.id === type)
      const handle = registered ? zen.panels.open(String(type)) : null
      if (!handle) throw new Error(`No panel type "${String(type)}". panels.list shows the types.`)
      if (str(title)) handle.setTitle(str(title)!)
      return { panel_id: handle.id }
    },
  })

  register({
    id: 'panels.arrange',
    effect: 'write',
    description:
      'Move, resize, dock, rename, focus, minimize, maximize or close an open panel. Coordinates are screen pixels.',
    params: {
      type: 'object',
      properties: {
        panel_id: { type: 'string' },
        title: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        dock: { type: 'string', enum: ['left', 'right', 'bottom', 'sidebar', 'float'] },
        action: { type: 'string', enum: ['focus', 'minimize', 'maximize', 'close'] },
      },
      required: ['panel_id'],
    },
    run: ({ panel_id, title, x, y, width, height, dock, action }) => {
      const handle = openHandle(zen, panel_id)
      if (str(title)) handle.setTitle(str(title)!)
      if (dock !== undefined) handle.dock(dock === 'float' ? null : (dock as DockSide))
      const size = { x: num(x), y: num(y), w: num(width), h: num(height) }
      if (Object.values(size).some((v) => v !== undefined)) handle.setSize(size, true)
      if (action === 'close') {
        handle.close()
        return { panel_id: handle.id, closed: true }
      }
      if (action === 'minimize') handle.minimize()
      else if (action === 'maximize') handle.maximize()
      else handle.focus()
      return { panel_id: handle.id, rect: handle.getRect() }
    },
  })

  register({
    id: 'panels.command',
    effect: 'write',
    description:
      "Run one of an open panel's own commands (panels.list shows them under `commands`, with their args).",
    params: {
      type: 'object',
      properties: {
        panel_id: { type: 'string' },
        command: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['panel_id', 'command'],
    },
    run: ({ panel_id, command, args }) =>
      runPanelCommand(
        zen,
        panel_id,
        String(command),
        args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
      ),
  })

  register({
    id: 'media.list',
    effect: 'read',
    description:
      'List ComfyUI\'s output (or input) files, newest first, as media refs — e.g. to find "the last 3 outputs". ' +
      'Pass the refs on to viewer.show, media.view or use_as_input.',
    params: {
      type: 'object',
      properties: {
        folder: { type: 'string', enum: ['output', 'input'], description: 'Default output.' },
        limit: { type: 'number', description: 'Default 10.' },
        kind: { type: 'string', enum: ['image', 'video', 'audio'] },
        search: { type: 'string', description: 'Only names containing this text.' },
      },
    },
    run: async ({ folder, limit, kind, search }) => {
      const dir = folder === 'input' ? 'input' : 'output'
      const res = await fetch(api.internalURL(`/files/${dir}`))
      if (!res.ok) throw new Error(`Could not list the ${dir} folder (${res.status}).`)
      const names = ((await res.json()) as string[]).map((n) => n.replace(/ \[\w+\]$/, ''))
      const needle = str(search)?.toLowerCase()
      const files = names
        .filter((n) => !kind || kindOf(n) === kind)
        .filter((n) => !needle || n.toLowerCase().includes(needle))
      const count = Math.max(1, Math.min(100, num(limit) ?? 10))
      return {
        total: files.length,
        media: files.slice(0, count).map((n) => ({ media: `${dir}/${n}`, kind: kindOf(n) })),
      }
    },
  })

  register({
    id: 'media.view',
    effect: 'write',
    description: 'Show media full screen to the user (a lightbox over everything).',
    params: {
      type: 'object',
      properties: { media: { type: 'array', items: { type: 'string' } } },
      required: ['media'],
    },
    run: async ({ media }) => {
      const items = await Promise.all(
        (Array.isArray(media) ? media : []).map((ref) => zen.media.resolve(String(ref))),
      )
      if (!items.length) throw new Error('Nothing to show.')
      zen.viewer.open(items.map((i) => ({ src: i.url, kind: i.kind, label: i.label })))
      return { shown: items.length }
    },
  })
}
