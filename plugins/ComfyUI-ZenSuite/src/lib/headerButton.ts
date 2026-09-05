/**
 * addNodeHeaderButton — put a control (e.g. a settings cog) in a node's header,
 * working on BOTH ComfyUI renderers, as a small reusable API for any node:
 *
 *   const cog = addNodeHeaderButton(node, widgetRootEl, {
 *     icon: 'mdi mdi-cog',        // Nodes 2.0 (DOM header) button
 *     text: '⚙',             // Nodes 1.0 (canvas title button) glyph
 *     title: 'Settings',
 *     onClick: () => { ... },
 *   })
 *   cog.setActive(true)           // reflect on/off state on both renderers
 *   cog.destroy()                 // on widget unmount
 *
 * Nodes 2.0 renders the header as DOM (`.lg-node-header`) but ignores litegraph
 * `title_buttons`; Nodes 1.0 is the reverse (canvas title buttons, no header DOM).
 * We register both, so the right one shows on each — and the DOM side self-heals
 * across 1.0<->2.0 switches (the header DOM is destroyed/recreated).
 */

export interface NodeHeaderButtonOptions {
  icon: string // mdi class for the Nodes 2.0 DOM button
  text?: string // glyph for the Nodes 1.0 canvas title button (default cog)
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
const LG_IDLE_BG = '#2a2a30'

function findHeader(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start
  for (let i = 0; el && i < 12; i++) {
    const h = el.querySelector?.('.lg-node-header') as HTMLElement | null
    if (h) return h
    el = el.parentElement
  }
  return null
}

export function addNodeHeaderButton(
  node: unknown,
  widgetEl: HTMLElement | null,
  opts: NodeHeaderButtonOptions,
): NodeHeaderButtonHandle {
  let active = false

  // --- Nodes 2.0: absolutely-positioned DOM button in the header (inline, far right) ---
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'zen-hdr-btn'
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
  btn.addEventListener('pointerdown', (e) => e.stopPropagation())
  btn.addEventListener('pointerup', (e) => e.stopPropagation())
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    opts.onClick()
  })
  // Absorb double-click so it never reaches the header → litegraph would otherwise
  // start the node-title rename when the cog is clicked twice quickly.
  btn.addEventListener('dblclick', (e) => {
    e.stopPropagation()
    e.preventDefault()
  })

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

  // --- Nodes 1.0: a litegraph canvas title button ---
  const n = node as LiteNode
  const redraw = () => (n.setDirtyCanvas ?? n.graph?.setDirtyCanvas)?.(true, true)
  let lgBtn: { bgColor?: string; fgColor?: string } | null = null
  if (typeof n.addTitleButton === 'function') {
    try {
      // xOffset nudges it inward so it isn't jammed against the title-bar edge.
      lgBtn = n.addTitleButton({ text: opts.text ?? '⚙', name: 'zensuite-header-btn', xOffset: -8 })
      const prev = n.onTitleButtonClick
      n.onTitleButtonClick = function (this: unknown, button: unknown, canvas: unknown) {
        prev?.call(this, button, canvas)
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
      if (lgBtn && Array.isArray(n.title_buttons)) {
        const i = n.title_buttons.indexOf(lgBtn)
        if (i >= 0) n.title_buttons.splice(i, 1)
        redraw()
      }
    },
    setActive(on: boolean) {
      active = on
      applyActive()
    },
  }
}
