/**
 * A Bind node's controls in a ZenKit panel, to tile into a workspace. The node remembers it is
 * popped out (a property, so it survives a reload) and reopens its panel when the workflow loads;
 * the panel id names the graph and the node, so ZenKit keeps its tile and drops it with the node.
 */
import { markRaw, type Component } from 'vue'
import { hasZenPanels, openZenPanel, type ZenPanelHandle } from '@nynxz/zenkit-nodekit'

import { openPanels, type BindNode } from './store'

const POPPED = 'zenBindPoppedOut'
const handles = new WeakMap<object, ZenPanelHandle>()
const quiet = new WeakSet<object>()
let body: Component | null = null

/** The component the panel shows — the Bind node's own body, registered once. */
export function setPanelBody(component: Component): void {
  body = markRaw(component)
}

function panelId(node: BindNode): string {
  const graph = node.graph?.rootGraph?.id ?? node.graph?.id
  return graph ? `zenbind:${graph}:${node.id}` : `zenbind.${node.id}`
}

function remember(node: BindNode, popped: boolean) {
  node.properties ??= {}
  if (Boolean(node.properties[POPPED]) === popped) return
  node.properties[POPPED] = popped
  node.graph?.change?.()
}

export function canPopOut(): boolean {
  return hasZenPanels()
}

/** `reveal`: asked for, so a panel tiled in a workspace that isn't showing goes there. */
export function popOut(node: BindNode, reveal = false): void {
  if (!body) return
  const existing = handles.get(node)
  if (existing) {
    existing.focus()
    return
  }
  const handle = openZenPanel(
    {
      id: panelId(node),
      title: node.title || 'Zen Bind',
      icon: 'mdi mdi-tune-variant',
      width: 380,
      height: 460,
      minWidth: 260,
      minHeight: 160,
      persist: true,
      reveal,
      props: { node, panel: true },
      onClose: () => {
        handles.delete(node)
        openPanels.delete(node)
        if (quiet.delete(node)) return
        remember(node, false)
      },
    },
    body,
  )
  if (!handle) return
  handles.set(node, handle)
  openPanels.add(node)
  remember(node, true)
  const previous = node.onRemoved
  node.onRemoved = function (this: unknown, ...args: unknown[]) {
    const h = handles.get(node)
    if (h) {
      quiet.add(node)
      h.close({ keep: true })
    }
    return previous?.apply(this, args)
  }
}

/** Reopen the panel of a node saved popped out. ZenKit can finish starting after the node loads,
 *  so this waits a little for it rather than give up. */
export function restore(node: BindNode): void {
  if (!node.properties?.[POPPED]) return
  let tries = 0
  const attempt = () => {
    if (handles.has(node)) return
    if (hasZenPanels()) popOut(node)
    else if (++tries < 40) setTimeout(attempt, 250)
  }
  attempt()
}
