// Turn per-node definitions into one ComfyUI extension: widgets register by io type,
// nodeCreated applies sizing and the run-result mapper, settings and slot-links are collected.

import { app } from '@comfy/app'
import { mountWidget } from './mountWidget'
import { registerSlotLink } from './zenGraph'
import type { Identity } from './identity'
import type { NodeDef } from './defineNode'

/** What a node module is allowed to default-export: one node def, or several. */
type NodeModule = { default: NodeDef | NodeDef[] }

/**
 * Collect every node def from a set of node modules — by convention `frontend/nodes/*.ts`, each
 * default-exporting `defineNode(...)` (or an array of them). These are the nodes widget discovery
 * can't produce: a node that reuses another file's widget type, or one with no widget at all.
 *
 * The caller hands us the result of globbing them (see the pack's `main.ts`) and we flatten it.
 * Vite resolves that glob at BUILD time into static imports, so a new file is picked up by the
 * next build with no shared file to edit.
 *
 * It has to be passed in rather than globbed here: `import.meta.glob` patterns are resolved
 * relative to the file they appear in, so a glob written inside nodekit could never see the
 * pack's files. Keeping the pattern at the call site is also what leaves nodekit with no
 * knowledge of where a pack puts its nodes.
 */
export function discoverNodes(modules: Record<string, unknown>, identity?: Identity): NodeDef[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b)) // stable order regardless of filesystem listing
    .flatMap(([path, mod]) => {
      const def = (mod as NodeModule)?.default
      if (!def) {
        console.warn(
          `[${identity?.DISPLAY_NAME ?? 'nodekit'}] ${path} has no default export — skipped`,
        )
        return []
      }
      return Array.isArray(def) ? def : [def]
    })
}

// The bits of a litegraph node we touch on create.
type LGNode = {
  constructor?: { comfyClass?: string }
  size: [number, number]
  setSize: (s: [number, number]) => void
  hideOutputImages?: boolean
  widgets?: { name: string; value: unknown; callback?: (v: unknown) => void }[]
  onExecuted?: (output: unknown) => void
}

const asArray = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v])

/** The python schema's `default`, from the `[type, options]` spec ComfyUI passes in. */
function schemaDefault(inputData: unknown): unknown {
  if (Array.isArray(inputData)) return (inputData[1] as { default?: unknown } | undefined)?.default
  if (inputData && typeof inputData === 'object')
    return (inputData as { default?: unknown }).default
  return undefined
}

/** Register every node's frontend as a single ComfyUI extension.
 *
 *  Bind it via `createNodekit`, which supplies `identity` and defaults `name` to the pack
 *  namespace — so pack code just calls `registerNodes(defs)`. */
export function registerNodes(defs: NodeDef[], name: string, identity: Identity): void {
  // comfyClass → def (an `is` array maps every class to the same def).
  const byClass = new Map<string, NodeDef>()
  for (const def of defs) for (const cls of asArray(def.is ?? [])) byClass.set(cls, def)

  // Widgets are global by io-type — register each type once (a type shared across nodes only
  // needs declaring on one def).
  const widgets: Record<
    string,
    (node: unknown, inputName: string, inputData?: unknown) => unknown
  > = {}
  for (const def of defs)
    for (const w of def.widgets ?? []) {
      if (widgets[w.type]) continue
      widgets[w.type] = (node, inputName, inputData) =>
        mountWidget(
          node as never,
          {
            widgetName: w.name ?? inputName,
            widgetType: w.type,
            component: w.component,
            minHeight: w.minHeight,
            minWidth: w.minWidth,
            fill: w.fill,
            dragThrough: w.dragThrough,
            serialize: w.serialize,
            defaultValue: w.default !== undefined ? w.default : schemaDefault(inputData),
          },
          identity,
        )
    }

  const settings = defs.flatMap((d) => d.settings ?? [])

  app.registerExtension({
    name,
    ...(settings.length ? { settings } : {}),
    getCustomWidgets() {
      return widgets
    },
    nodeCreated(node: unknown) {
      const lg = node as LGNode
      const def = byClass.get(lg.constructor?.comfyClass ?? '')
      if (!def) return
      if (def.minSize)
        lg.setSize([Math.max(lg.size[0], def.minSize[0]), Math.max(lg.size[1], def.minSize[1])])
      if (def.hideOutputImages) lg.hideOutputImages = true
      if (def.output) {
        const { widget, from } = def.output
        // Chain onExecuted and feed the ui output through the widget's callback. Never set
        // `w.value` — DOM widgets ignore serialize:false, so it would persist into the workflow.
        const prev = lg.onExecuted
        lg.onExecuted = function (this: unknown, output: unknown) {
          prev?.call(this, output)
          const w = lg.widgets?.find((c) => c.name === widget)
          if (!w) return
          const value = from((output ?? {}) as Record<string, unknown>)
          try {
            w.callback?.(value)
          } catch (err) {
            console.warn(`[${identity.DISPLAY_NAME}] output handler failed for ${widget}`, err)
          }
        }
      }
    },
  } as never)

  // Slot-links: middle-click the matched slot → spawn + wire the companion. They register once
  // ZenKit is up; no-op without it. They live as long as the page, so the unregister is dropped.
  for (const def of defs)
    for (const sl of def.slotLinks ?? [])
      for (const cls of asArray(def.is ?? []))
        void registerSlotLink({
          on:
            sl.input != null
              ? { node: cls, input: sl.input }
              : { node: cls, output: sl.output as string },
          spawn: sl.spawn,
        })
}
