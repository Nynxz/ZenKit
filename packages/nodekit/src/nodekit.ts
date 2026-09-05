// Bind the toolkit to one pack's identity.
//
// Bound at import time rather than via a configure() call: a pack's widget modules ask for
// nodeId() while being evaluated, which happens before main.ts's body runs.
//
//     // src/framework.ts
//     export const { nodeId, registerNodes, discoverWidgets } = createNodekit(manifest)

import { makeIdentity, type Identity, type PackManifest } from './identity'
import { registerNodes as _registerNodes, discoverNodes } from './registerNodes'
import { discoverWidgets as _discoverWidgets, widgetTypes as _widgetTypes } from './discoverWidgets'
import { mountWidget as _mountWidget, type DOMWidget, type MountOptions } from './mountWidget'
import {
  addNodeHeaderButton as _addNodeHeaderButton,
  type NodeHeaderButtonHandle,
  type NodeHeaderButtonOptions,
} from './nodeHeaderButton'
import type { NodeDef } from './defineNode'

export interface Nodekit extends Identity {
  /** Turn per-node definitions into one ComfyUI extension. */
  registerNodes(defs: NodeDef[], extensionName?: string): void
  /** Flatten globbed `widget.ts` modules into node defs. */
  discoverNodes(modules: Record<string, unknown>): NodeDef[]
  /** Turn globbed `widgets/*.vue` files into node defs by filename convention. */
  discoverWidgets(modules: Record<string, unknown>): NodeDef[]
  /** The io types a widget glob registers — for a startup log or a contract check. */
  widgetTypes(modules: Record<string, unknown>): string[]
  /** Mount a Vue app inside a node body. Normally called for you by `registerNodes`. */
  mountWidget(node: never, opts: MountOptions): { widget: DOMWidget }
  /** Put a control in a node's title bar. */
  addNodeHeaderButton(
    node: unknown,
    widgetEl: HTMLElement | null,
    opts: NodeHeaderButtonOptions,
  ): NodeHeaderButtonHandle
}

export function createNodekit(pack: PackManifest): Nodekit {
  const identity = makeIdentity(pack)
  return {
    ...identity,
    registerNodes: (defs, extensionName) =>
      _registerNodes(defs, extensionName ?? identity.NAMESPACE, identity),
    discoverNodes: (modules) => discoverNodes(modules, identity),
    discoverWidgets: (modules) => _discoverWidgets(modules, identity),
    widgetTypes: (modules) => _widgetTypes(modules, identity),
    mountWidget: (node, opts) => _mountWidget(node, opts, identity),
    addNodeHeaderButton: (node, el, opts) => _addNodeHeaderButton(node, el, opts, identity),
  }
}
