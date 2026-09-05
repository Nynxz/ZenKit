// Filesystem-convention widget discovery: `widgets/LoraStack.vue` -> io type
// `NYNXZ_LORA_STACK` via `typeId`. The python schema derives the same string from the same
// component name, so neither side writes it out.
//
// The glob is passed in because `import.meta.glob` patterns resolve relative to the file they
// appear in.

import type { Identity } from './identity'
import type { NodeDef, NodeWidgetDef } from './defineNode'

/** Widget-level overrides. `type` and `component` come from the file, so they are excluded. */
export type WidgetOptions = Omit<NodeWidgetDef, 'component' | 'type'>

/** What a widget's .vue file may export beyond its component. */
export interface WidgetFileExports {
  default: NodeWidgetDef['component']
  /** Tweaks to this widget: `minHeight`, `fill`, `dragThrough`, `serialize`, `default`, `name`. */
  widgetOptions?: WidgetOptions
  /** Node-level behaviour for the classes using it: `is`, `minSize`, `output`, `slotLinks`, … */
  nodeDef?: Omit<NodeDef, 'widgets'>
}

/** Strip a glob key down to the component name: `../widgets/LoraStack.vue` -> `LoraStack`. */
export function componentName(filePath: string): string {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.vue$/, '')
}

/** Turn globbed widget files into node defs, ordered by path for stable registration. */
export function discoverWidgets(modules: Record<string, unknown>, identity: Identity): NodeDef[] {
  const seen = new Set<string>()
  const defs: NodeDef[] = []

  for (const [path, raw] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const mod = raw as WidgetFileExports | undefined
    const name = componentName(path)
    const type = identity.typeId(name)

    if (!mod?.default) {
      console.warn(`[${identity.DISPLAY_NAME}] ${path} has no default export — skipped`)
      continue
    }
    if (seen.has(type)) {
      console.warn(
        `[${identity.DISPLAY_NAME}] duplicate widget type ${type} from ${path} — skipped`,
      )
      continue
    }
    seen.add(type)

    defs.push({
      ...mod.nodeDef,
      widgets: [{ type, component: mod.default, ...mod.widgetOptions }],
    })
  }
  return defs
}

/** The io types a glob would register — for a startup log or a build-time contract check. */
export function widgetTypes(modules: Record<string, unknown>, identity: Identity): string[] {
  return Object.keys(modules)
    .map((p) => identity.typeId(componentName(p)))
    .sort()
}
