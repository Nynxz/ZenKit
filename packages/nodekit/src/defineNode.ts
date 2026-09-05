// One declarative definition per node, colocated with its component and consumed by
// registerNodes — instead of a widget factory, a nodeCreated branch and a registration call in
// three separate places.

import type { Component } from 'vue'

/** A DOM widget mounted in a node body (one Vue component per custom io type). */
export interface NodeWidgetDef {
  /** Defaults to ComfyUI's input id. `output.widget` must match whichever it ends up being. */
  name?: string
  /** The io type ComfyUI keys the widget on. Build it with `typeId()`. */
  type: string
  component: Component
  minHeight?: number
  /** Stretch to fill the node body (stays user-resizable) instead of growing to fit content. */
  fill?: boolean
  /** Visual-only body: a press falls through to drag/select the node. */
  dragThrough?: boolean
  /** Persist the value with the graph (default true; false for transient run results). */
  serialize?: boolean
  /** Initial value. Defaults to the python schema's `default`. */
  default?: unknown
}

/** Middle-click a slot → spawn + wire a companion node. Lights up only when ZenKit is
 *  installed (a graceful no-op otherwise). Give exactly one of `input` / `output`. */
export interface SlotLinkDef {
  input?: string
  output?: string
  spawn: string
}

/** Everything about one node's frontend, in one place. */
export interface NodeDef {
  /** The comfyClass / V3 node_id this attaches to — build it with `nodeId()` from `@framework`.
   *  An array applies the same body behavior (sizing, widgets, …) to several node classes at
   *  once, for a family of nodes that share a UI.
   *  Optional — widgets register globally by io type; only per-node behaviour needs it. */
  is?: string | string[]
  /** Floor size applied on create: `setSize(max(current, min))`. */
  minSize?: [number, number]
  /** Suppress ComfyUI's default bottom image preview (when the node renders its own). */
  hideOutputImages?: boolean
  /** DOM widgets to mount. Registered globally by `type` — declare a shared type once. */
  widgets?: NodeWidgetDef[]
  /** Map the node's `ui` output onto a widget on execute. Python side: `io.NodeOutput(…, ui=…)`. */
  output?: { widget: string; from: (output: Record<string, any>) => unknown }
  /** Slot-link compositions owned by this node. */
  slotLinks?: SlotLinkDef[]
  /** Node-scoped ComfyUI settings. Build ids with `settingId()`. */
  settings?: Record<string, unknown>[]
}

/** Identity helper — typing plus a stable colocation point per node folder. */
export function defineNode(def: NodeDef): NodeDef {
  return def
}
