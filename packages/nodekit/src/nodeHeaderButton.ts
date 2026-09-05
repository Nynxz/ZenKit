/**
 * Put a control (typically a settings cog) in a node's title bar.
 *
 *   const cog = addNodeHeaderButton(node, widgetRootEl, {
 *     icon: 'mdi mdi-cog',   // Vue nodes: class on an <i> in the DOM header
 *     text: '\u2699',            // canvas nodes: glyph for the title button
 *     title: 'Settings',
 *     onClick: () => {},
 *   })
 *   cog.destroy()            // in onBeforeUnmount
 *
 * Registers on both renderers: the Vue one draws the header as DOM and ignores litegraph's
 * `title_buttons`; the canvas one has no header DOM. The DOM side re-attaches on an interval,
 * since a renderer switch destroys and recreates the header.
 */

import type { Identity } from './identity'

export interface NodeHeaderButtonOptions {
  /** Icon class for the Nodes 2.0 DOM button — include the base class: `'mdi mdi-cog'`. */
  icon: string
  /** Glyph for the Nodes 1.0 canvas title button (default '⚙'). */
  text?: string
  title?: string
  onClick: () => void
  /** Background for the active state on the 1.0 canvas button. */
  activeColor?: string
}

export interface NodeHeaderButtonHandle {
  destroy(): void
  setActive(on: boolean): void
}

interface LiteNode {
  addTitleButton?: (o: Record<string, unknown>) => { bgColor?: string; fgColor?: string }
  onTitleButtonClick?: (b: unknown, c: unknown) => void
  title_buttons?: { bgColor?: string; fgColor?: string }[]
  setDirtyCanvas?: (fg: boolean, bg: boolean) => void
  graph?: { setDirtyCanvas?: (fg: boolean, bg: boolean) => void }
}

const ACCENT = '#6366f1'
const LG_IDLE_BG = '#0f1f0f'

/** Walk up from the widget element looking for the node's DOM header (Nodes 2.0 only). */
function findHeader(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start
  for (let i = 0; el && i < 12; i++) {
    const header = el.querySelector?.('.lg-node-header') as HTMLElement | null
    if (header) return header
    el = el.parentElement
  }
  return null
}

export function addNodeHeaderButton(
  node: unknown,
  widgetEl: HTMLElement | null,
  opts: NodeHeaderButtonOptions,
  identity: Identity,
): NodeHeaderButtonHandle {
  let active = false

  // ── Nodes 2.0: a DOM button pinned to the right of the header ───────────────────────────
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `${identity.NAMESPACE}-hdr-btn`
  btn.title = opts.title ?? ''
  const icon = document.createElement('i')
  icon.className = opts.icon
  btn.appendChild(icon)
  Object.assign(btn.style, {
    position: 'absolute',
    right: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: '2',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'inherit',
    opacity: '0.6',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px',
    fontSize: '15px',
    lineHeight: '1',
    transition: 'opacity .12s ease, color .12s ease',
  })
  // The header is a drag handle; without these a press on the cog starts moving the node.
  btn.addEventListener('pointerdown', (e) => e.stopPropagation())
  btn.addEventListener('pointerup', (e) => e.stopPropagation())
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    opts.onClick()
  })
  // Absorb double-click too, or toggling twice quickly opens litegraph's title rename.
  btn.addEventListener('dblclick', (e) => {
    e.stopPropagation()
    e.preventDefault()
  })

  // Re-attach on an interval: the header DOM is recreated on renderer switches and on some
  // re-renders, and a one-shot append would silently vanish.
  const ensure = () => {
    const header = findHeader(widgetEl)
    if (!header) {
      if (btn.parentElement) btn.remove()
      return
    }
    if (getComputedStyle(header).position === 'static') header.style.position = 'relative'
    if (btn.parentElement !== header) header.appendChild(btn)
  }
  ensure()
  const interval = window.setInterval(ensure, 500)

  // ── Nodes 1.0: a litegraph canvas title button ──────────────────────────────────────────
  const lg = node as LiteNode
  const redraw = () => (lg.setDirtyCanvas ?? lg.graph?.setDirtyCanvas)?.(true, true)
  let lgBtn: { bgColor?: string; fgColor?: string } | null = null
  if (typeof lg.addTitleButton === 'function') {
    try {
      lgBtn = lg.addTitleButton({
        text: opts.text ?? '⚙',
        name: `${identity.NAMESPACE}-header-btn`,
        xOffset: -8,
      })
      // Chain: litegraph dispatches every title button through one handler.
      const previous = lg.onTitleButtonClick
      lg.onTitleButtonClick = function (this: unknown, button: unknown, canvas: unknown) {
        previous?.call(this, button, canvas)
        if (button === lgBtn) opts.onClick()
      }
    } catch {
      lgBtn = null
    }
  }

  const applyActive = () => {
    btn.style.opacity = active ? '1' : '0.6'
    btn.style.color = active ? `var(--zen-accent, ${ACCENT})` : 'inherit'
    if (lgBtn) {
      lgBtn.bgColor = active ? (opts.activeColor ?? ACCENT) : LG_IDLE_BG
      redraw()
    }
  }

  return {
    destroy() {
      window.clearInterval(interval)
      btn.remove()
      if (lgBtn && Array.isArray(lg.title_buttons)) {
        const i = lg.title_buttons.indexOf(lgBtn)
        if (i >= 0) lg.title_buttons.splice(i, 1)
        redraw()
      }
    },
    setActive(on: boolean) {
      active = on
      applyActive()
    },
  }
}
