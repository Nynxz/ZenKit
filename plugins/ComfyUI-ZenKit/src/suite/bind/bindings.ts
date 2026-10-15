/**
 * Zen Bind's model: which widgets of which nodes a Bind node shows, and how each one is edited.
 * Pure — no Vue, no app — so it can be tested on its own.
 */

/** One bound widget: a node in the Bind node's graph and one of its widgets, by name. */
export interface Binding {
  id: string
  node: string
  widget: string
  /** Shown instead of the widget's name. */
  label?: string
}

export type ControlKind = 'number' | 'combo' | 'toggle' | 'text' | 'multiline' | 'mirror'

export interface WidgetLike {
  name: string
  type?: string
  value?: unknown
  hidden?: boolean
  options?: {
    min?: number
    max?: number
    step2?: number
    step?: number
    precision?: number
    round?: number
    values?: unknown
    hidden?: boolean
    multiline?: boolean
  }
  callback?: (value: unknown, ...rest: unknown[]) => void
  /** A ZenKit widget's own component, mountable again elsewhere (nodekit's widgetMirror). */
  zenMirror?: { fill: boolean; mount: (el: HTMLElement) => () => void }
}

export interface InputLike {
  link?: number | null
  widget?: { name?: string }
}

export interface NodeLike {
  id: number | string
  type?: string
  title?: string
  widgets?: WidgetLike[]
  inputs?: InputLike[]
}

export const BIND_TYPE = 'zen.Bind'
export const PROPERTY = 'zenBindings'

/** How a widget is edited, or null when Zen Bind can't show it (images, buttons, plain DOM
 *  widgets). A ZenKit widget — a LoRA stack, a scene editor — is shown as itself. */
export function controlKind(w: WidgetLike): ControlKind | null {
  if (typeof w.zenMirror?.mount === 'function') return 'mirror'
  switch (w.type) {
    case 'number':
    case 'slider':
    case 'knob':
      return 'number'
    case 'combo':
      return 'combo'
    case 'toggle':
    case 'boolean':
      return 'toggle'
    case 'text':
    case 'string':
      return w.options?.multiline ? 'multiline' : 'text'
    case 'customtext':
      return 'multiline'
    default:
      return null
  }
}

/** The widget's input is wired, so its value comes from the link and editing it does nothing. */
export function isLinked(node: NodeLike, w: WidgetLike): boolean {
  return !!node.inputs?.some((i) => i.widget?.name === w.name && i.link != null)
}

/** The widgets of `node` a Bind node can show. */
export function bindableWidgets(node: NodeLike): WidgetLike[] {
  return (node.widgets ?? []).filter(
    (w) => !!w.name && controlKind(w) !== null && !isLinked(node, w),
  )
}

export function comboValues(w: WidgetLike, node?: NodeLike): unknown[] {
  const values = w.options?.values
  if (Array.isArray(values)) return values
  if (typeof values === 'function') {
    try {
      const out = (values as (w: WidgetLike, n?: NodeLike) => unknown)(w, node)
      return Array.isArray(out) ? out : []
    } catch {
      return []
    }
  }
  return []
}

export interface NumberSpec {
  min?: number
  max?: number
  step: number
  precision: number
}

export function numberSpec(w: WidgetLike): NumberSpec {
  const o = w.options ?? {}
  const step = o.step2 ?? (o.step != null ? o.step / 10 : 1)
  const precision =
    o.precision ?? (Number.isInteger(step) ? 0 : Math.max(0, -Math.floor(Math.log10(step))))
  return {
    min: Number.isFinite(o.min) ? o.min : undefined,
    max: Number.isFinite(o.max) ? o.max : undefined,
    step,
    precision,
  }
}

const SEEDS = /(^|_)seed$/

export function isSeed(w: WidgetLike): boolean {
  return controlKind(w) === 'number' && SEEDS.test(w.name)
}

/** A random seed within the widget's range (capped where JavaScript integers stay exact). */
export function randomSeed(w: WidgetLike, random = Math.random): number {
  const { min = 0, max = Number.MAX_SAFE_INTEGER } = numberSpec(w)
  const lo = Math.max(0, Math.ceil(min))
  const hi = Math.min(max, Number.MAX_SAFE_INTEGER)
  return lo + Math.floor(random() * (hi - lo + 1))
}

/** A Bind node's saved bindings, keeping only well-formed ones. */
export function readBindings(raw: unknown): Binding[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((b) => {
    if (!b || typeof b !== 'object') return []
    const { id, node, widget, label } = b as Record<string, unknown>
    if (node == null || typeof widget !== 'string' || !widget) return []
    return [
      {
        id: typeof id === 'string' && id ? id : uid(),
        node: String(node),
        widget,
        ...(typeof label === 'string' && label.trim() ? { label: label.trim() } : {}),
      },
    ]
  })
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function hasBinding(bindings: Binding[], node: string | number, widget: string): boolean {
  return bindings.some((b) => b.node === String(node) && b.widget === widget)
}

/** `bindings` with that widget added, or removed when it is already there. */
export function toggleBinding(
  bindings: Binding[],
  node: string | number,
  widget: string,
): Binding[] {
  return hasBinding(bindings, node, widget)
    ? bindings.filter((b) => !(b.node === String(node) && b.widget === widget))
    : [...bindings, { id: uid(), node: String(node), widget }]
}

/** `bindings` with the one at `from` moved to `to`. */
export function moveBinding(bindings: Binding[], from: number, to: number): Binding[] {
  if (from === to || from < 0 || from >= bindings.length) return bindings
  const next = [...bindings]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved!)
  return next
}
