import { describeNode } from './graphTools'

// What an approval card says about a call: one plain sentence, the details that matter for that
// tool, and a warning when the action can't be undone. Node ids are looked up on the canvas, so
// the user sees "KSampler #3", not just "#3".

export interface CallSummary {
  title: string
  lines: { label: string; value: string }[]
  warning?: string
}

const MAX_LINES = 6

const str = (v: unknown) => (typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v)))
const short = (v: unknown, max = 80) => {
  const s = str(v)
  return s.length > max ? `${s.slice(0, max)}…` : s
}
const node = (id: unknown) => describeNode(id)?.label ?? `node #${str(id)} (not on the canvas)`

function argLines(args: Record<string, unknown>): CallSummary['lines'] {
  return Object.entries(args).map(([label, value]) => ({ label, value: short(value) }))
}

function capped(lines: CallSummary['lines']): CallSummary['lines'] {
  return lines.length > MAX_LINES
    ? [
        ...lines.slice(0, MAX_LINES - 1),
        { label: '…', value: `${lines.length - MAX_LINES + 1} more` },
      ]
    : lines
}

function runLines(variations: unknown): CallSummary['lines'] {
  if (!Array.isArray(variations) || !variations.length) return []
  return variations.map((v, i) => {
    const changes = (Array.isArray(v) ? v : [v])
      .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
      .flatMap((o) =>
        'node_id' in o
          ? [`#${str(o.node_id)} ${str(o.widget)} = ${short(o.value, 40)}`]
          : Object.entries(o).map(([k, val]) => `${k} = ${short(val, 40)}`),
      )
    return { label: `Run ${i + 1}`, value: changes.join(', ') || 'as it is' }
  })
}

const IRREVERSIBLE =
  "Runs use your GPU, or credits for paid API nodes, and can't be undone. Stop cancels the ones still queued."

/** The card's text for a call the model wants to make. */
export function summarize(name: string, args: Record<string, unknown> | null): CallSummary {
  const a = args ?? {}
  switch (name) {
    case 'add_node':
      return {
        title: `Add a ${str(a.type)} node`,
        lines: argLines((a.widgets as Record<string, unknown>) ?? {}),
      }
    case 'set_widget': {
      const current = describeNode(a.node_id)?.widgets[str(a.name)]
      return {
        title: `Change ${str(a.name)} on ${node(a.node_id)}`,
        lines: [
          ...(current !== undefined ? [{ label: 'from', value: short(current) }] : []),
          { label: 'to', value: short(a.value) },
        ],
      }
    }
    case 'connect':
      return {
        title: 'Connect two nodes',
        lines: [
          { label: 'from', value: `${node(a.from_node)} · ${str(a.output)}` },
          { label: 'to', value: `${node(a.to_node)} · ${str(a.input)}` },
        ],
      }
    case 'disconnect':
      return { title: `Disconnect ${str(a.input)} on ${node(a.node_id)}`, lines: [] }
    case 'remove_node':
      return {
        title: `Delete ${node(a.node_id)}`,
        lines: [],
        ...(a.force === true
          ? { warning: 'Forced: it goes even if other nodes depend on it.' }
          : {}),
      }
    case 'move_node':
      return {
        title: `Move ${node(a.node_id)}`,
        lines: [{ label: 'to', value: `${str(a.x)}, ${str(a.y)}` }],
      }
    case 'resize_node':
      return {
        title: `Resize ${node(a.node_id)}`,
        lines:
          a.fit === true
            ? [{ label: 'size', value: 'fit to contents' }]
            : argLines({ width: a.width, height: a.height }),
      }
    case 'tidy_layout':
      return {
        title:
          Array.isArray(a.node_ids) && a.node_ids.length
            ? `Rearrange ${a.node_ids.length} nodes`
            : 'Rearrange the whole workflow',
        lines: [],
      }
    case 'queue_prompt': {
      const runs = Array.isArray(a.variations) && a.variations.length ? a.variations.length : 1
      return {
        title: runs > 1 ? `Run the workflow ${runs} times` : 'Run the workflow',
        lines: capped(runLines(a.variations)),
        warning: IRREVERSIBLE,
      }
    }
    case 'use_as_input':
      return {
        title: `Load ${short(a.media, 60)} into ${node(a.node_id)}`,
        lines: a.widget ? [{ label: 'widget', value: str(a.widget) }] : [],
        warning: "Copies the file into ComfyUI's input folder when it isn't there yet.",
      }
    case 'workflows_open':
      return { title: `Switch to the workflow “${str(a.workflow)}”`, lines: [] }
    case 'workflows_new':
      return { title: 'Open a new, blank workflow', lines: [] }
    case 'workflows_open_template':
      return { title: `Open the template “${str(a.template)}”`, lines: [] }
    case 'viewer_show':
      return { title: 'Show media in a Media Viewer', lines: capped(argLines(a)) }
    case 'media_view':
      return { title: 'Show media full screen', lines: capped(argLines(a)) }
    case 'panels_open':
      return { title: `Open the ${str(a.title ?? a.type)} panel`, lines: [] }
    case 'panels_command':
      return {
        title: `Run “${str(a.command)}” on ${str(a.panel_id)}`,
        lines: capped(argLines((a.args as Record<string, unknown>) ?? {})),
      }
    default:
      return { title: `Use ${name.replace(/_/g, ' ')}`, lines: capped(argLines(a)) }
  }
}
