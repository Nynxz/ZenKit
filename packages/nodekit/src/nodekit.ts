// Bind the toolkit to one pack's identity.
//
// Bound at import time rather than via a configure() call: a pack's widget modules ask for
// nodeId() while being evaluated, which happens before main.ts's body runs.
//
//     // frontend/framework.ts
//     export * from '@nynxz/zenkit-nodekit'
//     export const { nodeId, registerNodes, discoverWidgets } = createNodekit(manifest)

import { makeIdentity, type Identity, type PackManifest } from './identity'
import { registerNodes as _registerNodes, discoverNodes } from './registerNodes'
import { discoverWidgets as _discoverWidgets, widgetTypes as _widgetTypes } from './discoverWidgets'
import { api } from '@comfy/api'

import {
  mountWidget as _mountWidget,
  type DOMWidget,
  type MountOptions,
  type NodeLike,
} from './mountWidget'
import {
  addNodeHeaderButton as _addNodeHeaderButton,
  type NodeHeaderButtonHandle,
  type NodeHeaderButtonOptions,
} from './nodeHeaderButton'
import type { NodeDef } from './defineNode'
import { createMediaLibrary, type MediaLibrary } from './mediaLibrary'
import { createPackMedia, type PackMedia } from './packMedia'

export interface Nodekit extends Identity, PackMedia {
  /** Turn per-node definitions into one ComfyUI extension. */
  registerNodes(defs: NodeDef[], extensionName?: string): void
  /** Flatten globbed node modules (`frontend/nodes/*.ts`) into node defs. */
  discoverNodes(modules: Record<string, unknown>): NodeDef[]
  /** Turn globbed `widgets/*.vue` files into node defs by filename convention. */
  discoverWidgets(modules: Record<string, unknown>): NodeDef[]
  /** The io types a widget glob registers — for a startup log or a contract check. */
  widgetTypes(modules: Record<string, unknown>): string[]
  /** Mount a Vue app inside a node body. Normally called for you by `registerNodes`. */
  mountWidget(node: NodeLike, opts: MountOptions): { widget: DOMWidget }
  /** Put a control in a node's title bar. */
  addNodeHeaderButton(
    node: unknown,
    widgetEl: HTMLElement | null,
    opts: NodeHeaderButtonOptions,
  ): NodeHeaderButtonHandle
  /** The full URL of one of the pack's routes, `route(path)` on ComfyUI's API (base-path safe):
   *  what to `fetch`. */
  routeUrl(path: string): string
  /** ComfyUI's media folders, listed by the pack's `media` route (see mediaLibrary.ts). */
  mediaLibrary: MediaLibrary
  // thumbUrl, uploadOrReuse, mediaInfo: the pack's other media routes (see packMedia.ts).
}

export function createNodekit(pack: PackManifest): Nodekit {
  const identity = makeIdentity(pack)
  return {
    ...identity,
    routeUrl: (path) => (api as { apiURL: (p: string) => string }).apiURL(identity.route(path)),
    registerNodes: (defs, extensionName) =>
      _registerNodes(defs, extensionName ?? identity.NAMESPACE, identity),
    discoverNodes: (modules) => discoverNodes(modules, identity),
    discoverWidgets: (modules) => _discoverWidgets(modules, identity),
    widgetTypes: (modules) => _widgetTypes(modules, identity),
    mountWidget: (node, opts) => _mountWidget(node, opts, identity),
    addNodeHeaderButton: (node, el, opts) => _addNodeHeaderButton(node, el, opts, identity),
    mediaLibrary: createMediaLibrary(identity.route('media')),
    ...createPackMedia(identity.route('media')),
  }
}
