// Offer an action to the rest of ZenKit — and to agents, which see every capability as a tool.
// A graceful no-op without ZenKit.

import { whenZen } from './zenkit'
import type { Capability } from '../../client/src/contract'

export type ZenCapability = Omit<Capability, 'plugin'>

/** Register `capability` once ZenKit is up; resolves to its unregister, or null without ZenKit. */
export async function registerZenCapability(
  capability: ZenCapability,
): Promise<(() => void) | null> {
  const zen = await whenZen()
  if (!zen?.capabilities?.register) return null
  try {
    return zen.capabilities.register(capability)
  } catch {
    return null
  }
}
