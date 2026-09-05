import type { ThemePack } from '@nynxz/zenkit-types'
import { parsePack } from './pack'

// Packs are registered at runtime (loaded from theme JSON files / user themes),
// not baked into this package.
const registry = new Map<string, ThemePack>()

/** Validate and register a pack. Returns the stored pack, or null if invalid. */
export function registerPack(pack: unknown): ThemePack | null {
  const valid = parsePack(pack)
  if (!valid) return null
  registry.set(valid.id, valid)
  return valid
}

/** Register many packs; returns the ones that were valid. */
export function registerPacks(list: unknown[]): ThemePack[] {
  const out: ThemePack[] = []
  for (const p of list) {
    const valid = registerPack(p)
    if (valid) out.push(valid)
  }
  return out
}

/** All registered packs, in registration order. */
export function packs(): ThemePack[] {
  return [...registry.values()]
}

/** Look up a registered pack by id. */
export function getPack(id: string): ThemePack | undefined {
  return registry.get(id)
}

/** Drop all registered packs (mainly for tests / reloads). */
export function clearPacks(): void {
  registry.clear()
}
