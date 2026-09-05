// Optional ZenKit graph composition — middle-click a node's slot to spawn + auto-connect a
// companion node. Talks to `window.ZenKit` directly rather than importing @nynxz/zenkit-client: a
// graceful no-op when ZenKit isn't installed, so a pack built from this template works fine
// standalone and the feature simply lights up when ZenKit is present.
//
// (The @nynxz/zenkit-ui components a node's Vue body uses are a separate thing entirely — those are
// bundled from source at build time and have no runtime dependency on ZenKit.)

interface SlotMatch {
  /** litegraph node.type (== the node's V3 node_id / comfyClass). */
  node: string
  /** Match an OUTPUT slot by name (mutually exclusive with `input`). */
  output?: string
  /** Match an INPUT slot by name. */
  input?: string
}
interface ZenGraphLike {
  slotLink(spec: { on: SlotMatch; spawn: string }): () => void
}
interface ZenKitLike {
  ready?: Promise<ZenKitLike>
  graph?: ZenGraphLike
}

function getZenKit(): ZenKitLike | null {
  return (
    (typeof window !== 'undefined' && (window as unknown as { ZenKit?: ZenKitLike }).ZenKit) || null
  )
}

// Resolve ZenKit once it's ready, or null after `timeout` ms if it never loads. Handles
// either load order: ZenKit fires a `zen:ready` window event on boot, and exposes a
// `.ready` promise when it's already present.
function whenZenKit(timeout = 6000): Promise<ZenKitLike | null> {
  const now = getZenKit()
  if (now) return now.ready ?? Promise.resolve(now)
  if (typeof window === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.removeEventListener('zen:ready', finish)
      resolve(getZenKit())
    }
    window.addEventListener('zen:ready', finish)
    window.setTimeout(finish, timeout)
  })
}

/** Middle-click the matched slot → spawn `spawn` and auto-connect it. No-op without ZenKit. */
export function registerSlotLink(spec: { on: SlotMatch; spawn: string }): void {
  whenZenKit().then((zen) => {
    try {
      zen?.graph?.slotLink?.(spec)
    } catch {
      /* ignore — composition is best-effort */
    }
  })
}
