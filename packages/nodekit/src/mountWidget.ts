/**
 * Mount a Vue app inside a `node.addDOMWidget` container. `addDOMWidget` routes `widget.value`
 * through getValue/setValue (closure-backed here, so it serializes with the graph). The
 * component receives `{ widget, node }`.
 *
 * The widget auto-grows: `getMinHeight` reports live content height and a ResizeObserver nudges
 * the node. Pass `fill` to stretch into a user-resized node instead.
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
  graph?: { setDirtyCanvas?: (a: boolean, b: boolean) => void }
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
 *  inputs use (ZenNumber's stepper spans, ZenSwitch, ZenToggleGroup, ZenSelect's trigger), and
 *  `data-zen-drag` for a component's own custom drag surface. */
const INTERACTIVE =
  'button, input, select, textarea, a[href], [contenteditable="true"], [data-zen-drag],' +
  '[role="button"], [role="slider"], [role="switch"], [role="tab"], [role="combobox"], [role="checkbox"]'

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
    overflow: fill ? 'hidden' : 'visible',
    pointerEvents: opts.dragThrough ? 'none' : 'auto',
    ...(fill ? { height: '100%', minHeight: `${opts.minHeight ?? 80}px` } : {}),
  })

  // Vue mounts into `inner` — content-driven by default, stretched in fill mode.
  const inner = document.createElement('div')
  inner.style.width = '100%'
  if (fill)
    Object.assign(inner.style, {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box',
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
    getMinHeight: () => (fill ? floor : Math.max(floor, Math.ceil(inner.scrollHeight))),
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

  // resize the node to fit content whenever it changes (rows added/removed, reflow)
  function fit() {
    try {
      if (typeof node.computeSize === 'function' && typeof node.setSize === 'function') {
        const sz = node.computeSize()
        node.setSize([node.size?.[0] ?? sz[0], sz[1]])
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
        ro = new ResizeObserver(() => fit())
        ro.observe(inner)
      }
      live.set(widget, { app, ro })
      if (!fill) fit()
      // dragThrough: the renderer wraps our container in a host slot that swallows pointer
      // events (Vue-nodes' WidgetDOM has its own @pointerdown.stop). Neutralize that wrapper
      // too so a press on the body reaches the node. Retry until the renderer parents us.
      if (opts.dragThrough) {
        const transp = () => {
          const h = container.parentElement as HTMLElement | null
          if (h) h.style.pointerEvents = 'none'
        }
        transp()
        ;[60, 200, 600, 1500].forEach((t) => window.setTimeout(transp, t))
      }
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
