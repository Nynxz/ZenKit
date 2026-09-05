/**
 * Mount a Vue component as a content-sized DOM widget on a litegraph node — the
 * panel-free way to put custom controls on a node (works on both ComfyUI renderers).
 *
 * Unlike a serialised widget, this owns no value: the component drives the node's
 * existing (hidden) widgets. The widget grows/shrinks to its content via a
 * ResizeObserver, so a collapsible panel makes the node shrink when collapsed.
 */

import { createApp, type Component, type App as VueApp } from 'vue'

interface DOMWidget {
  onRemove?: () => void
}
interface NodeLike {
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

export interface MountControlsOptions {
  /** Size the widget from the NODE instead of from its content.
   *
   *  Content-sizing (the default) is right for a panel of controls: the node hugs whatever the
   *  component renders. It's wrong for anything with a viewport — a wall of images, a list —
   *  because the node's height then becomes an output of a SETTING. Turn `count` up and the node
   *  grows to a thousand pixels; the height is never yours.
   *
   *  With `fill`, the widget reports a fixed floor and stretches into whatever height the node
   *  is given, so dragging the node resizes the viewport and the content scrolls inside it. The
   *  component must cooperate: a `height: 100%; min-height: 0` root (`<ZenWidget fill>`) and an
   *  `overflow: auto` region, or the content will simply spill. */
  fill?: boolean
  /** Floor for the widget's height, in px. Only meaningful with `fill`. */
  minHeight?: number
}

export function mountNodeControls(
  node: NodeLike,
  name: string,
  component: Component,
  extraProps: Record<string, unknown> = {},
  opts: MountControlsOptions = {},
): void {
  const fill = !!opts.fill
  const floor = opts.minHeight ?? 120

  const container = document.createElement('div')
  Object.assign(container.style, {
    width: '100%',
    // fill: clip at the node's edge — the viewport inside is what scrolls.
    overflow: fill ? 'hidden' : 'visible',
    pointerEvents: 'auto',
    ...(fill ? { height: '100%', minHeight: `${floor}px` } : {}),
  })
  const inner = document.createElement('div')
  inner.style.width = '100%'
  if (fill)
    Object.assign(inner.style, {
      height: '100%',
      minHeight: '0',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
    })
  container.appendChild(inner)

  const widget = node.addDOMWidget(name, 'zen-controls', container, {
    // fill: a FIXED floor, so ComfyUI hands the widget the node's spare height instead of the
    // node being resized to the content. content: grow to fit what's rendered.
    getMinHeight: () => (fill ? floor : Math.max(0, Math.ceil(inner.scrollHeight))),
    hideOnZoom: false,
    serialize: false,
  })

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
    let app: VueApp | undefined
    let ro: ResizeObserver | undefined
    try {
      app = createApp(component, { node, ...extraProps })
      app.mount(inner)
      // Only content-sized widgets refit the node. Under `fill` the node's height is the user's
      // — refitting it to the content would drag it back every time an image loaded, which is
      // exactly the behaviour `fill` exists to stop.
      if (!fill) {
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => fit())
          ro.observe(inner)
        }
        fit()
      } else {
        node.graph?.setDirtyCanvas?.(true, true)
      }
    } catch (err) {
      console.error('[ZenSuite] mount controls failed', err)
      return
    }
    const prev = widget.onRemove
    widget.onRemove = () => {
      try {
        ro?.disconnect()
        app?.unmount()
      } catch {
        /* already gone */
      }
      try {
        prev?.call(widget)
      } catch {
        /* chained */
      }
    }
  })
}
