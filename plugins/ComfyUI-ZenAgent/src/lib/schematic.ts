import type { LayoutGraph, LayoutNode } from './layout'
import { boxOf } from './layout'

// A plain drawing of the graph for a vision model to read the layout from: each node a labelled
// box, wires coloured by type, overlaps in red, the agent's own nodes outlined, and gridlines
// labelled in canvas units so what it sees maps onto move_node coordinates.

export interface SchematicNode extends LayoutNode {
  title?: string
  type: string
  inputs?: { link?: number | null; type?: string }[]
}

const WIRE: Record<string, string> = {
  MODEL: '#b39ddb',
  CLIP: '#ffd500',
  CONDITIONING: '#ffa931',
  LATENT: '#ff9cf9',
  IMAGE: '#64b5f6',
  VAE: '#ff6e6e',
  MASK: '#81c784',
}
const MAX_W = 1280
const MAX_H = 900
const PAD = 40

function gridStep(span: number): number {
  for (const step of [100, 200, 250, 500, 1000, 2000, 5000]) if (span / step <= 12) return step
  return 10000
}

export function renderSchematic(g: LayoutGraph, mine: Set<number>, only?: Set<number>): { image: string; bounds: number[] } {
  const all = g.nodes().filter((n) => !only || only.has(n.id)) as SchematicNode[]
  if (!all.length) throw new Error('The workflow is empty.')
  const boxes = new Map(all.map((n) => [n.id, boxOf(n)]))
  const xs = [...boxes.values()].flatMap((b) => [b.x, b.x + b.w])
  const ys = [...boxes.values()].flatMap((b) => [b.y, b.y + b.h])
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  const scale = Math.min((MAX_W - PAD * 2) / (x1 - x0), (MAX_H - PAD * 2) / (y1 - y0), 1)
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.ceil((x1 - x0) * scale + PAD * 2),
    height: Math.ceil((y1 - y0) * scale + PAD * 2),
  })
  const ctx = canvas.getContext('2d')!
  const X = (x: number) => PAD + (x - x0) * scale
  const Y = (y: number) => PAD + (y - y0) * scale

  ctx.fillStyle = '#16161a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Gridlines in canvas units.
  const step = gridStep(Math.max(x1 - x0, y1 - y0))
  ctx.font = '11px sans-serif'
  ctx.strokeStyle = '#2a2a31'
  ctx.fillStyle = '#6b6b78'
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    ctx.beginPath()
    ctx.moveTo(X(x), PAD / 2)
    ctx.lineTo(X(x), canvas.height)
    ctx.stroke()
    ctx.fillText(String(x), X(x) + 2, 12)
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    ctx.beginPath()
    ctx.moveTo(PAD / 2, Y(y))
    ctx.lineTo(canvas.width, Y(y))
    ctx.stroke()
    ctx.fillText(String(y), 2, Y(y) - 2)
  }

  // Wires, from the source's right edge to the target's left edge at their slots.
  const slot = (box: { y: number }, i: number) => box.y + 30 + (i + 0.7) * 20
  for (const node of all) {
    node.inputs?.forEach((input, i) => {
      const l = input.link != null ? g.link(input.link) : undefined
      const from = l && boxes.get(l.origin_id)
      const to = boxes.get(node.id)!
      if (!l || !from) return
      const [sx, sy, tx, ty] = [X(from.x + from.w), Y(slot(from, l.origin_slot)), X(to.x), Y(slot(to, i))]
      ctx.strokeStyle = WIRE[input.type ?? ''] ?? '#9e9e9e'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      const bend = Math.max(30, Math.abs(tx - sx) / 2)
      ctx.bezierCurveTo(sx + bend, sy, tx - bend, ty, tx, ty)
      ctx.stroke()
    })
  }

  // Boxes; any that overlap another are filled red.
  const hit = new Set<number>()
  const list = [...boxes.entries()]
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const [ia, a] = list[i]!
      const [ib, b] = list[j]!
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hit.add(ia).add(ib)
    }
  ctx.lineWidth = 1.5
  for (const node of all) {
    const b = boxes.get(node.id)!
    const [x, y, w, h] = [X(b.x), Y(b.y), b.w * scale, b.h * scale]
    ctx.fillStyle = hit.has(node.id) ? 'rgba(220, 60, 60, 0.55)' : 'rgba(52, 52, 62, 0.92)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = mine.has(node.id) ? '#4fc3f7' : '#5c5c6a'
    ctx.lineWidth = mine.has(node.id) ? 3 : 1.5
    ctx.strokeRect(x, y, w, h)
    const label = `#${node.id} ${node.title || node.type}`
    const size = Math.max(10, Math.min(14, 30 * scale))
    ctx.font = `bold ${size}px sans-serif`
    ctx.fillStyle = '#f0f0f5'
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.fillText(label, x + 5, y + size + 3)
    ctx.restore()
  }
  return { image: canvas.toDataURL('image/png'), bounds: [x0, y0, x1, y1].map(Math.round) }
}
