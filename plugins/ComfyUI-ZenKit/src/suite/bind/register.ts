/**
 * Zen Bind: a canvas-only node that gathers widgets from other nodes into one list of controls,
 * on the node or in a ZenKit panel tiled into a workspace.
 *
 * It is a VIRTUAL node: no Python class, kept out of the prompt by `isVirtualNode`, so it never
 * runs and never invalidates the cache. It only edits the widgets it is bound to. Bindings are
 * the node's properties, so they travel with the workflow.
 */
import { app } from '@comfy/app'

import { mountNodeControls } from '@/suite/lib/mountControls'
import { BIND_TYPE, bindableWidgets, hasBinding, toggleBinding, type NodeLike } from './bindings'
import { restore, setPanelBody } from './panel'
import {
  bindNodesIn,
  bindingsOf,
  reloadBindings,
  setBindings,
  type BindNode,
  type GraphLike,
} from './store'
import ZenBind from './ZenBind.vue'

const TITLE = 'Zen Bind'
const CATEGORY = 'Zen/Suite'

interface LGraphNodeLike extends BindNode {
  isVirtualNode?: boolean
  serialize_widgets?: boolean
  onConfigure?(info: unknown): void
}
interface LiteGraphGlobals {
  LGraphNode: new (title?: string) => LGraphNodeLike
  LiteGraph: {
    registerNodeType: (type: string, ctor: unknown) => void
    createNode: (type: string) => BindNode | null
  }
}
interface NodeDefLike {
  name: string
  display_name?: string
  category?: string
  python_module?: string
  description?: string
}
interface MenuItem {
  content: string
  callback?: () => void
  has_submenu?: boolean
  submenu?: { options: (MenuItem | null)[] }
}

function bindItems(target: NodeLike, bind: BindNode): MenuItem[] {
  return bindableWidgets(target).map((w) => ({
    content: `${hasBinding(bindingsOf(bind).value, target.id, w.name) ? '✓ ' : ''}${w.name}`,
    callback: () => setBindings(bind, toggleBinding(bindingsOf(bind).value, target.id, w.name)),
  }))
}

/** A new Bind node beside `target`, already bound to one of its widgets. */
function newBindWith(
  target: NodeLike & { pos?: [number, number]; size?: [number, number] },
  widget: string,
) {
  const { LiteGraph } = window as unknown as LiteGraphGlobals
  const graph = (target as BindNode).graph as GraphLike | null | undefined
  const bind = LiteGraph.createNode(BIND_TYPE)
  if (!bind || !graph?.add) return
  const [x, y] = target.pos ?? [0, 0]
  bind.pos = [x + (target.size?.[0] ?? 300) + 40, y]
  graph.add(bind)
  setBindings(bind, toggleBinding([], target.id, widget))
}

function menuFor(node: NodeLike): (MenuItem | null)[] {
  if (node.type === BIND_TYPE) return []
  const widgets = bindableWidgets(node)
  if (!widgets.length) return []
  const binds = bindNodesIn((node as BindNode).graph)
  let options: MenuItem[]
  if (!binds.length)
    options = widgets.map((w) => ({
      content: `${w.name} → new Zen Bind`,
      callback: () => newBindWith(node, w.name),
    }))
  else if (binds.length === 1) options = bindItems(node, binds[0]!)
  else
    options = binds.map((b) => ({
      content: b.title || `${TITLE} #${b.id}`,
      has_submenu: true,
      submenu: { options: bindItems(node, b) },
    }))
  return [null, { content: 'Bind to Zen Bind', has_submenu: true, submenu: { options } }]
}

export function registerBind(): void {
  setPanelBody(ZenBind)
  app.registerExtension({
    name: 'nynxz.zenkit.bind',
    registerCustomNodes() {
      const { LGraphNode, LiteGraph } = window as unknown as LiteGraphGlobals

      class ZenBindNode extends LGraphNode {
        static title = TITLE
        static comfyClass = BIND_TYPE
        #mounted = false

        constructor(title?: string) {
          super(title ?? TITLE)
          this.isVirtualNode = true
          this.serialize_widgets = false
          this.properties ??= {}
          this.size = [340, 220]
        }

        onAdded() {
          if (this.#mounted) return
          this.#mounted = true
          mountNodeControls(this as never, 'zen_bind', ZenBind, {}, { fill: true, minHeight: 120 })
        }

        onConfigure() {
          reloadBindings(this)
          restore(this)
        }
      }

      LiteGraph.registerNodeType(BIND_TYPE, ZenBindNode)
      ;(ZenBindNode as unknown as { category?: string }).category = CATEGORY
    },
    beforeRegisterVueAppNodeDefs(defs: NodeDefLike[]) {
      const def = defs.find((d) => d.name === BIND_TYPE)
      if (!def) return
      def.display_name = TITLE
      def.category = CATEGORY
      def.description =
        'Controls for widgets of other nodes, in one place — on the node or in a ZenKit panel. ' +
        'Right-click a node → Bind to Zen Bind.'
      const sibling = defs.find((d) => d.name.startsWith('zen.Channel.'))
      if (sibling?.python_module) def.python_module = sibling.python_module
    },
    getNodeMenuItems(node: NodeLike) {
      return menuFor(node)
    },
  } as never)
}
