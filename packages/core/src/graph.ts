// ZenKit graph composition. Lets node authors override MIDDLE-CLICK on a node's input/
// output slot to spawn + connect a companion node, instead of ComfyUI's default
// reroute/auto-node. We defensively wrap LGraphCanvas.prototype._processMiddleButton
// (reached via the live `window.app.canvas`), do our own slot hit-test, and only act when
// a registered override matches — otherwise the original runs unchanged. No-op (graceful)
// if the canvas/method isn't there (different ComfyUI version, headless, etc.).
import type { SlotMatch, SlotMiddleClickCtx, ZenGraph } from './types'
import { zlog, zwarn } from './log'

type Dir = 'in' | 'out'
type Handler = (ctx: SlotMiddleClickCtx) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export function createGraph(): ZenGraph {
  const registry = new Map<string, Handler>() // key: `${nodeType}\0${dir}\0${slotName}`
  const keyOf = (nodeType: string, dir: Dir, slot: string) => `${nodeType}\0${dir}\0${slot}`

  const comfyApp = (): Any => (window as unknown as { app?: Any }).app
  function resolveLiteGraph(): Any {
    const w = window as Any
    return (
      w.LiteGraph ??
      w.comfyAPI?.litegraph?.LiteGraph ??
      comfyApp()?.canvas?.constructor?.LiteGraph ??
      null
    )
  }
  function createNode(type: string, pos?: [number, number]): unknown {
    const LG = resolveLiteGraph()
    if (!LG?.createNode) {
      zwarn(`graph.createNode: LiteGraph not reachable — can't create "${type}"`)
      return null
    }
    const n = LG.createNode(type)
    if (!n) {
      zwarn(`graph.createNode: unknown node type "${type}"`)
      return null
    }
    if (pos) n.pos = pos
    return n
  }

  // Hit-test the slot under a middle-click. Mirrors litegraph's own ±15/±10 slot boxes,
  // using getOutputPos/getInputPos (graph-absolute coords, same space as e.canvasX/Y).
  function hitSlot(
    node: Any,
    x: number,
    y: number,
  ): { index: number; isOutput: boolean; name: string } | null {
    const within = (p: Any) =>
      p && x >= p[0] - 15 && x <= p[0] + 15 && y >= p[1] - 10 && y <= p[1] + 10
    const outs = node.outputs || []
    for (let i = 0; i < outs.length; i++) {
      try {
        if (within(node.getOutputPos(i)))
          return { index: i, isOutput: true, name: outs[i]?.name ?? String(i) }
      } catch {
        /* slot without a position yet */
      }
    }
    const ins = node.inputs || []
    for (let i = 0; i < ins.length; i++) {
      try {
        if (within(node.getInputPos(i)))
          return { index: i, isOutput: false, name: ins[i]?.name ?? String(i) }
      } catch {
        /* ignore */
      }
    }
    return null
  }

  // Returns true if an override handled this middle-click (so the default is skipped).
  function tryOverride(canvas: Any, e: Any, node: Any): boolean {
    if (!node || !registry.size) return false
    const cx = e.canvasX ?? e.graphX
    const cy = e.canvasY ?? e.graphY
    const slot = hitSlot(node, cx, cy)
    if (!slot) return false
    const handler = registry.get(keyOf(node.type, slot.isOutput ? 'out' : 'in', slot.name))
    if (!handler) return false
    const sp = slot.isOutput ? node.getOutputPos(slot.index) : node.getInputPos(slot.index)
    const pos: [number, number] = [sp[0] + (slot.isOutput ? 70 : -270), sp[1] - 10]
    // Spawn + auto-connect a node of `type` to the clicked slot via the canvas's OWN
    // create-for-slot machinery — it uses ComfyUI's LiteGraph (so the type resolves), and
    // handles positioning + linking. This is the same call the default middle-click makes,
    // just with a concrete type instead of 'AUTO'.
    const spawn = (type: string): unknown => {
      try {
        // Mirror litegraph's own auto-placement (the default middle-click): anchor at the
        // node's far edge, nudge by the slot row, and let posSizeFix shift the new node left
        // by its own width on the input side — so it lands cleanly beside the node, not on it.
        const count = (slot.isOutput ? node.outputs?.length : node.inputs?.length) || 1
        const alphaPosY = 0.5 - (slot.index + 1) / count
        const nb = node.getBounding?.() ?? [
          node.pos?.[0] ?? cx,
          node.pos?.[1] ?? cy,
          node.size?.[0] ?? 200,
          node.size?.[1] ?? 120,
        ]
        const ok = canvas.createDefaultNodeForSlot?.({
          nodeFrom: slot.isOutput ? node : null,
          slotFrom: slot.isOutput ? slot.index : null,
          nodeTo: slot.isOutput ? null : node,
          slotTo: slot.isOutput ? null : slot.index,
          position: [slot.isOutput ? nb[0] + nb[2] : nb[0], cy - 80],
          nodeType: type,
          posAdd: [slot.isOutput ? 30 : -30, -alphaPosY * 130],
          posSizeFix: [slot.isOutput ? 0 : -1, 0],
        })
        if (!ok)
          zwarn(
            `graph.spawn: couldn't create/connect "${type}" (unknown type or incompatible slot?)`,
          )
        return ok
      } catch (err) {
        zwarn('graph.spawn threw', err)
        return false
      }
    }
    const run = () => {
      try {
        handler({
          node,
          slotIndex: slot.index,
          slotName: slot.name,
          isOutput: slot.isOutput,
          graph: canvas.graph,
          pos,
          spawn,
          createNode,
        })
        canvas.setDirty?.(true, true)
      } catch (err) {
        zwarn('graph: slot middle-click handler threw', err)
      }
    }
    // Defer to the click (so a middle-drag-to-pan doesn't fire it), matching litegraph.
    if (canvas.pointer) canvas.pointer.onClick = run
    else run()
    return true
  }

  // Patch the prototype once the canvas class is available (it mounts after setup()).
  let patched = false
  function ensurePatched(): void {
    if (patched) return
    const proto = comfyApp()?.canvas?.constructor?.prototype
    if (!proto || typeof proto._processMiddleButton !== 'function') return
    const orig = proto._processMiddleButton
    proto._processMiddleButton = function (this: Any, e: Any, node: Any) {
      try {
        if (tryOverride(this, e, node)) return
      } catch (err) {
        zwarn('graph: middle-click override failed', err)
      }
      return orig.call(this, e, node)
    }
    patched = true
    zlog('graph: middle-click slot overrides active')
  }
  // Only patch once something actually registers (the canvas mounts after setup(), so poll
  // briefly). Zero footprint if no plugin uses graph composition.
  let polling = false
  function startPatchPoll(): void {
    if (patched || polling) return
    polling = true
    let tries = 0
    const poll = () => {
      ensurePatched()
      if (!patched && tries++ < 40) window.setTimeout(poll, 250)
      else polling = false
    }
    poll()
  }

  function register(match: SlotMatch, handler: Handler): () => void {
    const dir: Dir = match.output != null ? 'out' : 'in'
    const slot = match.output ?? match.input
    if (!slot) {
      zwarn('graph.onSlotMiddleClick: match needs an `input` or `output` slot name', match)
      return () => {}
    }
    const k = keyOf(match.node, dir, slot)
    registry.set(k, handler)
    startPatchPoll()
    return () => {
      registry.delete(k)
    }
  }

  function slotLink(spec: { on: SlotMatch; spawn: string }): () => void {
    return register(spec.on, (ctx) => ctx.spawn(spec.spawn))
  }

  return { slotLink, onSlotMiddleClick: register, createNode }
}
