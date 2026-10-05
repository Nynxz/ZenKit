import type { Capability, PanelHandle, ZenKitApi } from '@nynxz/zenkit-client'

// What the Media Viewer offers agents and other plugins: put media into viewers, and gather
// open viewers into one. Media is given as refs (zen.media), and each viewer keeps them, so
// what a viewer shows can be handed on (e.g. as a workflow input).

const VIEWER = 'zensuite:viewer'
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

interface ViewerState {
  items?: { url: string; ref?: string; label?: string; kind?: string }[]
}

async function command(handle: PanelHandle, name: string, args: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    if (handle.commands().some((c) => c.name === name) || attempt >= 30) return handle.run(name, args)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export function viewerCapabilities(zen: () => ZenKitApi): Capability[] {
  const openViewer = (title?: string) => {
    const handle = zen().panels.open(VIEWER)
    if (!handle) throw new Error('The Media Viewer is not registered.')
    if (title) handle.setTitle(title)
    return handle
  }
  const titleOf = (id: string) => zen().panels.instances(VIEWER).find((i) => i.id === id)?.title

  async function show(refs: string[], opts: { panelId?: string; title?: string; replace?: boolean }) {
    const items = await Promise.all(refs.map((ref) => zen().media.resolve(ref)))
    const existing = opts.panelId ? zen().panels.get(opts.panelId) : null
    if (opts.panelId && !existing?.getRect()) throw new Error(`No open Media Viewer "${opts.panelId}".`)
    const handle = existing ?? openViewer(opts.title)
    if (existing && opts.title) handle.setTitle(opts.title)
    handle.restore()
    handle.focus()
    const result = await command(handle, 'show', {
      items: items.map((i) => ({ url: i.url, ref: i.ref, label: i.label, kind: i.kind })),
      replace: opts.replace === true,
    })
    return { panel_id: handle.id, title: titleOf(handle.id), ...(result as object) }
  }

  return [
    {
      id: 'viewer.show',
      effect: 'write',
      description:
        'Show media in Media Viewer panels. By default it opens one new viewer showing only these items; ' +
        'panel_id adds them to an open viewer instead (replace=true clears it first); separate=true opens one ' +
        'viewer per item. Each viewer lists its items with their refs in panels.list.',
      params: {
        type: 'object',
        properties: {
          media: { type: 'array', items: { type: 'string' }, description: 'Media refs, e.g. output/ComfyUI_00012_.png' },
          panel_id: { type: 'string' },
          title: { type: 'string', description: "A name for the viewer, e.g. 'Red variants'" },
          replace: { type: 'boolean' },
          separate: { type: 'boolean' },
        },
        required: ['media'],
      },
      run: async ({ media, panel_id, title, replace, separate }) => {
        const refs = (Array.isArray(media) ? media : []).map(String)
        if (!refs.length) throw new Error('Give at least one media ref.')
        if (separate === true)
          return {
            viewers: await Promise.all(
              refs.map((ref, i) => show([ref], { title: str(title) && refs.length > 1 ? `${str(title)} ${i + 1}` : str(title) })),
            ),
          }
        return show(refs, { panelId: str(panel_id), title: str(title), replace: replace === true })
      },
    },
    {
      id: 'viewer.merge',
      effect: 'write',
      description:
        'Gather the items of every open Media Viewer into one (the first, or `into`) and close the others ' +
        '(unless close_others is false).',
      params: {
        type: 'object',
        properties: { into: { type: 'string', description: 'panel_id of the viewer to keep' }, close_others: { type: 'boolean' } },
      },
      run: async ({ into, close_others }) => {
        const ids = zen()
          .panels.instances(VIEWER)
          .map((i) => i.id)
          .filter((id) => zen().panels.get(id)?.getRect())
        const target = str(into) ?? ids[0]
        if (!target) throw new Error('No Media Viewer is open.')
        const sources = ids.filter((id) => id !== target)
        const itemsOf = (id: string) => (zen().panels.get(id)!.describe() as ViewerState | null)?.items ?? []
        const moved = sources.flatMap(itemsOf)
        // Rebuilt in viewer order: the kept viewer's items first, then each source's in turn.
        if (moved.length) await command(zen().panels.get(target)!, 'show', { items: [...itemsOf(target), ...moved], replace: true })
        if (close_others !== false) for (const id of sources) zen().panels.get(id)?.close()
        return { into: target, moved: moved.length, closed: close_others !== false ? sources : [] }
      },
    },
  ]
}
