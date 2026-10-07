// Pointing at a node on the canvas from elsewhere — a picker hovering over the node it would
// choose, say: a dotted outline that follows the node as the canvas pans and zooms, and a way to
// bring the node into view.

import { app } from '@comfy/app'

type Rect = [number, number, number, number]
interface CanvasNode {
  pos: ArrayLike<number>
  size: ArrayLike<number>
  getBounding?(): ArrayLike<number>
}

const PAD = 6

function nodeById(id: string | number): CanvasNode | null {
  return app.graph?.getNodeById?.(id) ?? null
}

function boundsOf(node: CanvasNode): Rect {
  const b = node.getBounding?.()
  if (b) return [b[0]!, b[1]!, b[2]!, b[3]!]
  const title = 30
  return [node.pos[0]!, node.pos[1]! - title, node.size[0]!, node.size[1]! + title]
}

function ensureStyle() {
  if (document.getElementById('zen-node-highlight-style')) return
  const style = document.createElement('style')
  style.id = 'zen-node-highlight-style'
  style.textContent = `
.zen-node-highlight {
  position: fixed;
  z-index: 9999;
  box-sizing: border-box;
  border: 2px dashed var(--zen-accent, #6366f1);
  border-radius: 10px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--zen-accent, #6366f1) 18%, transparent);
  pointer-events: none;
  animation: zen-node-highlight-in var(--zen-dur-fast, 120ms) ease-out;
}
.zen-node-highlight[data-label]::before {
  content: attr(data-label);
  position: absolute;
  bottom: 100%;
  left: -2px;
  margin-bottom: 4px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--zen-accent, #6366f1);
  color: #fff;
  font: 600 11px/1.5 system-ui, sans-serif;
  white-space: nowrap;
}
@keyframes zen-node-highlight-in { from { opacity: 0; transform: scale(1.03) } }`
  document.head.append(style)
}

/** Outline node `id` with a dotted line until the returned function is called. `label` shows
 *  above it. Hidden while the node is off the canvas or gone. */
export function highlightNode(id: string | number, label?: string): () => void {
  ensureStyle()
  const box = document.createElement('div')
  box.className = 'zen-node-highlight'
  if (label) box.dataset.label = label
  document.body.append(box)
  let frame = 0
  const place = () => {
    const node = nodeById(id)
    const canvas = app.canvas
    const el: HTMLElement | undefined = canvas?.canvas
    if (!node || !el) {
      box.style.display = 'none'
    } else {
      const [x, y, w, h] = boundsOf(node)
      const { scale, offset } = canvas.ds
      const r = el.getBoundingClientRect()
      const left = r.left + (x + offset[0]) * scale - PAD
      const top = r.top + (y + offset[1]) * scale - PAD
      const width = w * scale + PAD * 2
      const height = h * scale + PAD * 2
      const visible =
        left < r.right && top < r.bottom && left + width > r.left && top + height > r.top
      box.style.display = visible ? '' : 'none'
      Object.assign(box.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      })
    }
    frame = requestAnimationFrame(place)
  }
  place()
  return () => {
    cancelAnimationFrame(frame)
    box.remove()
  }
}

/** Pan (and zoom) the canvas so node `id` is in view. False when there's no such node. */
export function revealNode(id: string | number): boolean {
  const node = nodeById(id)
  const canvas = app.canvas
  if (!node || !canvas) return false
  if (canvas.animateToBounds) canvas.animateToBounds(boundsOf(node), { zoom: 0.6 })
  else canvas.centerOnNode?.(node)
  return true
}
