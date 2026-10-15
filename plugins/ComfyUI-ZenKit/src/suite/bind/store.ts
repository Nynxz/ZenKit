/**
 * Zen Bind against the live graph: each Bind node's bindings as one shared ref (the node body and
 * its panel edit the same list, saved in the node's properties), finding a binding's widget, and
 * writing a value the way editing it on its own node would.
 */
import { reactive, shallowRef, type ShallowRef } from 'vue'
import { app } from '@comfy/app'

import {
  BIND_TYPE,
  PROPERTY,
  readBindings,
  type Binding,
  type NodeLike,
  type WidgetLike,
} from './bindings'

export interface GraphLike {
  id?: string
  rootGraph?: { id?: string }
  nodes?: NodeLike[]
  _nodes?: NodeLike[]
  getNodeById?: (id: number | string) => NodeLike | null | undefined
  add?: (node: unknown) => void
  change?: () => void
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void
}

export interface BindNode extends NodeLike {
  pos?: [number, number]
  size?: [number, number]
  properties?: Record<string, unknown>
  graph?: GraphLike | null
  onRemoved?: (...args: unknown[]) => unknown
}

interface ChangeAware extends NodeLike {
  onWidgetChanged?: (name: string, value: unknown, old: unknown, widget: WidgetLike) => void
}

const lists = new WeakMap<object, ShallowRef<Binding[]>>()

export function bindingsOf(node: BindNode): ShallowRef<Binding[]> {
  let list = lists.get(node)
  if (!list) {
    list = shallowRef(readBindings(node.properties?.[PROPERTY]))
    lists.set(node, list)
  }
  return list
}

/** Take the bindings from the node's properties again — after a workflow loads into it. */
export function reloadBindings(node: BindNode): void {
  bindingsOf(node).value = readBindings(node.properties?.[PROPERTY])
}

export function setBindings(node: BindNode, next: Binding[]): void {
  bindingsOf(node).value = next
  node.properties ??= {}
  node.properties[PROPERTY] = next
  node.graph?.change?.()
}

export function graphNodes(graph: GraphLike | null | undefined): NodeLike[] {
  return graph?.nodes ?? graph?._nodes ?? []
}

export function bindNodesIn(graph: GraphLike | null | undefined): BindNode[] {
  return graphNodes(graph).filter((n) => n.type === BIND_TYPE) as BindNode[]
}

export interface Target {
  node: NodeLike
  widget: WidgetLike
}

/** The node and widget a binding points at, or null once either is gone. */
export function targetOf(bindNode: BindNode, binding: Binding): Target | null {
  const graph = bindNode.graph
  const node =
    graph?.getNodeById?.(
      Number.isNaN(Number(binding.node)) ? binding.node : Number(binding.node),
    ) ?? graphNodes(graph).find((n) => String(n.id) === binding.node)
  const widget = node?.widgets?.find((w) => w.name === binding.widget)
  return node && widget ? { node, widget } : null
}

/** Set a widget as editing it on its node would: its callback runs and the canvas redraws. */
export function writeWidget({ node, widget }: Target, value: unknown): void {
  const old = widget.value
  if (old === value) return
  widget.value = value
  widget.callback?.(value, app.canvas, node)
  ;(node as ChangeAware).onWidgetChanged?.(widget.name, value, old, widget)
  app.canvas?.setDirty?.(true, true)
  app.graph?.change?.()
}

/** Bind nodes whose panel is open, by node — the body shows a summary meanwhile. */
export const openPanels = reactive(new Set<object>())
