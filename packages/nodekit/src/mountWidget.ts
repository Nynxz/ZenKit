/**
 * Mount a Vue app inside a `node.addDOMWidget` container. `addDOMWidget` routes `widget.value`
 * through getValue/setValue (closure-backed here, so it serializes with the graph). The
 * component receives `{ widget, node }`.
 *
 * The widget auto-grows: `getMinHeight` reports live content height and a ResizeObserver nudges
 * the node. Pass `fill` to stretch into a user-resized node instead.
 *
 * Undo/redo reloads the whole graph, so every widget mounted here is destroyed and rebuilt on
 * ctrl+z. `reclaimSlot` is what keeps the rebuilt one visible — read its comment before changing
 * anything about when the mount and its follow-up ticks run.
 *
 * Under Vue nodes the body is real DOM and an unstopped press becomes a node-drag. The
 * delegated guard below covers controls; a custom drag surface (canvas, scrub bar, wipe handle)
 * needs `data-zen-drag` plus all four of:
 *   1. `touch-action: none` — or the browser fires pointercancel on the first pixel of movement.
 *   2. `user-select: none`.
 *   3. `pointer-events: none` on child img/overlays, so the stable container stays the target.
 *   4. `setPointerCapture` on that container, handling move/up/cancel there. Window listeners
 *      are not equivalent — without capture the browser may retarget mid-drag.
 *
 * Coordinates: the body sits in a CSS-transformed container, so `getBoundingClientRect()` is
 * post-transform while `offsetWidth` is not. Prefer ratio math; scale raw pixel deltas by
 * `rect.width / offsetWidth`.
 */

import { createApp, type Component, type App as VueApp } from 'vue'
import type { Identity } from './identity'

export interface DOMWidget {
  name: string
  type: string
  value: unknown
  options?: Record<string, unknown>
  callback?: (value: unknown) => void
  onRemove?: () => void
  serializeValue?: () => unknown
  /** ComfyUI's node serializer skips a widget entirely when this is `false`. */
  serialize?: boolean
}

interface NodeLike {
  id: number | string
  size?: [number, number]
  setSize?: (s: [number, number]) => void
  computeSize?: () => [number, number]
  graph?: { id?: string; setDirtyCanvas?: (a: boolean, b: boolean) => void }
  addDOMWidget: (
    name: string,
    type: string,
    el: HTMLElement,
    options?: Record<string, unknown>,
  ) => DOMWidget
}

export interface MountOptions {
  widgetName: string
  widgetType: string
  component: Component
  minHeight?: number
  /** The narrowest the node may be resized to while this widget is on it. */
  minWidth?: number
  defaultValue?: unknown
  /** Persist the value with the graph (default true). Set false for transient
   *  values like run results that go stale on restart. */
  serialize?: boolean
  /** Fill the node body (height:100%) and stay user-resizable, instead of growing
   *  to fit content. Use for image/preview widgets that should stretch. */
  fill?: boolean
  /** Make the widget "visual only": it AND the host slot the renderer wraps it in ignore
   *  pointer events, so a press on the body falls through to the node (drag/select it).
   *  Interactive bits inside must opt back in with `pointer-events: auto`. */
  dragThrough?: boolean
  /** Extra props for the component, merged over the default `{ widget, node }`.
   *
   *  The one case this exists for: a widget mounted on node A whose component must read and
   *  write node B. Promoting a custom widget out of a subgraph is exactly that — the widget
   *  lives on the host SubgraphNode, but its settings and its event subscription belong to the
   *  interior node it projects. Passing `{ node: interior }` here keeps ONE source of truth
   *  instead of copying the interior node's state onto the host. */
  props?: Record<string, unknown>
}

const live = new WeakMap<DOMWidget, { app: VueApp; ro?: ResizeObserver }>()

/** What counts as "a press here is aimed at a control, not at the node" — see the delegated
 *  pointerdown guard in mountWidget. Covers the native controls plus the ARIA roles the ZenKit
 *  inputs use (ZenNumber's stepper spans, ZenSwitch, ZenToggleGroup, ZenSelect's trigger), HTML5
 *  drag sources (a node-drag would swallow their dragstart), and
 *  `data-zen-drag` for a component's own custom drag surface. */
const INTERACTIVE =
  'button, input, select, textarea, a[href], [contenteditable="true"], [data-zen-drag],' +
  '[draggable="true"], [role="button"], [role="slider"], [role="switch"], [role="tab"], [role="combobox"],' +
  ' [role="checkbox"]'

/** Marks a container with the widget slot it belongs to. Read back by {@link reclaimSlot}. */
const SLOT = 'zenSlot'

/** `graph:node:widget` — the identity a widget slot keeps across a graph reload, and the same
 *  triple ComfyUI keys its widget host components on. Parts are escaped so a `:` in a name
 *  cannot forge another slot's key. `node.id` is `-1` until `configure` has run, so this is
 *  only meaningful from the mount microtask on. */
function slotKey(node: NodeLike, widgetName: string): string {
  const parts = [node.graph?.id ?? 'root', String(node.id), widgetName]
  return parts.map(encodeURIComponent).join(':')
}

/**
 * Take over the slot our dead predecessor is still sitting in, and report whether we are placed.
 *
 * Undo/redo (ctrl+z) reloads the entire graph: `loadGraphData` destroys every node and rebuilds
 * it with the SAME id. The Vue-nodes renderer keys a widget's host component on
 * `graphId:nodeId:name`, so that key is unchanged, the host is reused, and its one-shot
 * `onMounted` attach never runs again. The host keeps the PREVIOUS widget's element — which we
 * emptied in `onRemove` — while our fresh element is parented nowhere: the node body renders
 * blank until it is collapsed (which tears the host down) or the page is reloaded.
 *
 * Only ever when we are not already attached. On the canvas renderer the whole host is removed
 * and a fresh one appends us; swapping into a subtree that is about to be discarded would just
 * throw our element away. A predecessor Vue already unmounted is out of the document and so is
 * not found here, which is exactly the guard we want.
 */
function reclaimSlot(container: HTMLElement, key: string): boolean {
  if (container.isConnected) return true
  for (const el of document.querySelectorAll<HTMLElement>('[data-zen-slot]')) {
    if (el === container || el.dataset[SLOT] !== key) continue
    el.replaceWith(container)
    return true
  }
  return false
}

export function mountWidget(
  node: NodeLike,
  opts: MountOptions,
  identity: Identity,
): { widget: DOMWidget } {
  const fill = !!opts.fill
  // Fill mode: fixed getMinHeight and no ResizeObserver, so the node stays user-resizable.
  const container = document.createElement('div')
  container.dataset['packWidget'] = opts.widgetType
  Object.assign(container.style, {
    width: '100%',
    height: '100%',
    overflow: fill ? 'hidden' : 'visible',
    pointerEvents: opts.dragThrough ? 'none' : 'auto',
    ...(fill ? { minHeight: `${opts.minHeight ?? 80}px` } : {}),
  })

  // Vue mounts into `inner` — content-driven by default, stretched in fill mode. A content
  // widget still spans the node when the node is taller than its content (both renderers hand a
  // DOM widget the spare height), so a `data-zen-spacer` inside can push a footer to the bottom.
  const inner = document.createElement('div')
  Object.assign(inner.style, {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    ...(fill ? { height: '100%', overflow: 'hidden' } : { minHeight: '100%' }),
  })
  container.appendChild(inner)

  // Presses on a real control must not reach the node, or they become a node-drag. Delegated
  // here rather than per-component: `e.target` already knows, and a press on passive body space
  // still drags the node. The host still selects/raises from click/focus, so this costs nothing.
  // A component whose drag surface ISN'T a control — a canvas, a wipe handle — opts in by
  // marking it `data-zen-drag`, or keeps its own @pointerdown.stop.
  if (!opts.dragThrough)
    container.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement | null
      const hit = target?.closest?.(INTERACTIVE)
      if (hit && container.contains(hit)) e.stopPropagation()
    })

  const floor = opts.minHeight ?? 40
  const serialize = opts.serialize !== false
  let stored: unknown = opts.defaultValue
  const widget = node.addDOMWidget(opts.widgetName, opts.widgetType, container, {
    // fill: report a fixed floor and let ComfyUI hand the widget the node's spare
    // height (the component fills it). content: grow to fit the rendered content.
    getMinHeight: () => (fill ? floor : Math.max(floor, Math.ceil(contentHeight()))),
    hideOnZoom: false,
    serialize,
    // Transient (serialize:false) widgets NEVER expose the live value as the widget's value —
    // return the light default so nothing, not even ComfyUI's own save path (which reads the
    // value, ignoring serialize:false / serializeValue), can persist a heavy run result into
    // the workflow.
    getValue: () => (serialize ? stored : opts.defaultValue),
    setValue: (v: unknown) => {
      stored = v
    },
  })
  // Always define serializeValue so ComfyUI never falls back to the live `value`. (The
  // `serialize:false` option alone isn't honoured for DOM widgets in current ComfyUI — the
  // value still serialized via getValue.)
  widget.serializeValue = serialize ? () => stored : () => undefined
  // ...and the flag core's node serializer ACTUALLY reads is the top-level `widget.serialize`,
  // not `options.serialize` — `LGraphNode.serialize` skips a widget only on `serialize === false`.
  // Without this a transient widget still lands in `widgets_values` (as its default), which is
  // noise in every saved workflow, and on a subgraph host it is noise against a widget that only
  // exists at runtime.
  if (!serialize) widget.serialize = false

  // What the content needs, not what it was given. `inner` spans a taller node, so its own
  // height is the node's, not the content's — measuring it would ratchet the node (every fit
  // reporting its current size as the minimum). Sum the content instead, less whatever its
  // spacers absorbed: that stretch is slack, not content.
  function contentHeight() {
    let height = 0
    for (const child of inner.children) {
      const el = child as HTMLElement
      height += Math.max(el.offsetHeight, el.scrollHeight)
    }
    for (const el of inner.querySelectorAll<HTMLElement>('[data-zen-spacer]'))
      height -= el.offsetHeight
    return height
  }

  // Resize the node to fit content whenever it changes (rows added/removed, reflow). A node that
  // hugs its content keeps hugging it, shrinking too; one the user has made taller keeps its
  // height and only grows when the content outgrows it. The first fit respects the saved size.
  // Canvas renderer: its resize clamps to computeSize(). Vue nodes: the resize clamps to the node
  // element's inline min-width, which the renderer's own style binding leaves alone.
  const minWidth = opts.minWidth ?? 0
  if (minWidth && typeof node.computeSize === 'function') {
    const computeSize = node.computeSize.bind(node)
    node.computeSize = () => {
      const size = computeSize()
      return [Math.max(size[0], minWidth), size[1]]
    }
  }
  function applyMinWidth() {
    if (!minWidth) return
    const nodeEl = container.closest<HTMLElement>('[data-node-id]')
    if (nodeEl && nodeEl.style.minWidth !== `${minWidth}px`) nodeEl.style.minWidth = `${minWidth}px`
    if (node.size && node.size[0] < minWidth) node.setSize?.([minWidth, node.size[1]])
  }

  let fitted = 0
  function fit() {
    applyMinWidth()
    try {
      if (typeof node.computeSize === 'function' && typeof node.setSize === 'function') {
        const need = node.computeSize()[1]
        // The observer also fires while the user drags the node's height; the content hasn't
        // changed then, and resizing back to it would fight the drag.
        if (need === fitted) return
        const have = node.size?.[1] ?? need
        const hugging = fitted > 0 && have <= fitted + 1
        node.setSize([
          node.size?.[0] ?? node.computeSize()[0],
          hugging ? need : Math.max(have, need),
        ])
        fitted = need
      }
    } catch {
      /* layout not ready */
    }
    node.graph?.setDirtyCanvas?.(true, true)
  }

  Promise.resolve().then(() => {
    try {
      const app = createApp(opts.component, { widget, node, ...opts.props })
      app.mount(inner)
      // Fill widgets are sized by the node (user-resizable) — don't auto-fit to content.
      let ro: ResizeObserver | undefined
      if (!fill && typeof ResizeObserver !== 'undefined') {
        // `inner` never shrinks below the node, so content shrinking (a section collapsing)
        // shows up only on the content itself, or as a footer spacer growing.
        const watched = new Set<Element>()
        const watch = () => {
          for (const el of [inner, ...inner.children, ...inner.querySelectorAll('[data-zen-spacer]')])
            if (!watched.has(el)) {
              watched.add(el)
              ro?.observe(el)
            }
        }
        ro = new ResizeObserver(() => {
          watch()
          fit()
        })
        watch()
      }
      live.set(widget, { app, ro })
      if (!fill) fit()
      // dragThrough: the renderer wraps our container in a host slot that swallows pointer
      // events (Vue-nodes' WidgetDOM has its own @pointerdown.stop). Neutralize that wrapper
      // too so a press on the body reaches the node.
      const transp = () => {
        if (!opts.dragThrough) return
        const h = container.parentElement as HTMLElement | null
        if (h) h.style.pointerEvents = 'none'
      }
      // Stamp the slot, then keep checking that the renderer actually parented us — taking the
      // slot back from a dead predecessor when it did not (see reclaimSlot). rAF lands after
      // Vue has flushed; the later ticks cover a host that mounts a frame or two behind, and a
      // renderer switch that rebuilds the host slot from scratch. `transp` rides the same
      // schedule for the same reason: a one-shot would silently stop applying.
      const settle = () => {
        const key = slotKey(node, opts.widgetName)
        container.dataset[SLOT] = key
        reclaimSlot(container, key)
        transp()
        applyMinWidth()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(settle)
      else settle()
      ;[60, 200, 600, 1500].forEach((t) => window.setTimeout(settle, t))
    } catch (err) {
      console.error(`[${identity.DISPLAY_NAME}] failed to mount widget`, opts.widgetType, err)
    }
  })

  const prevOnRemove = widget.onRemove
  widget.onRemove = () => {
    try {
      const l = live.get(widget)
      if (l) {
        l.ro?.disconnect()
        l.app.unmount()
        live.delete(widget)
      }
    } catch (err) {
      console.error(`[${identity.DISPLAY_NAME}] widget unmount error`, err)
    }
    try {
      prevOnRemove?.call(widget)
    } catch (err) {
      console.error(`[${identity.DISPLAY_NAME}] chained onRemove error`, err)
    }
  }

  return { widget }
}
