// Optional ZenKit graph composition — middle-click a node's slot to spawn + auto-connect a
// companion node. A graceful no-op when ZenKit isn't installed, so a pack works fine standalone
// and the feature simply lights up when ZenKit is present.

import { whenZen, type SlotMatch } from './zenkit'

/** Middle-click the matched slot → spawn `spawn` and auto-connect it. Waits for ZenKit (as long
 *  as installing takes, once the host has announced itself) and resolves to an unregister fn; a
 *  no-op one without ZenKit. */
export async function registerSlotLink(spec: {
  on: SlotMatch
  spawn: string
}): Promise<() => void> {
  const zen = await whenZen()
  try {
    return zen ? zen.graph.slotLink(spec) : () => {}
  } catch {
    return () => {} // composition is best-effort
  }
}
