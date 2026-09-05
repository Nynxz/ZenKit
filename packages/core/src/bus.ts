// Tiny synchronous event bus; '*' receives every event; handler errors are isolated.

import type { BusHandler } from './types'

export function createBus() {
  const map = new Map<string, Set<BusHandler>>()

  function on(event: string, cb: BusHandler): () => void {
    let set = map.get(event)
    if (!set) {
      set = new Set()
      map.set(event, set)
    }
    set.add(cb)
    return () => off(event, cb)
  }
  function off(event: string, cb: BusHandler) {
    map.get(event)?.delete(cb)
  }
  function emit(event: string, payload?: unknown) {
    map.get(event)?.forEach((cb) => {
      try {
        cb(payload)
      } catch (e) {
        console.error(`[ZenKit] bus handler for "${event}" threw`, e)
      }
    })
    map.get('*')?.forEach((cb) => {
      try {
        cb({ event, payload })
      } catch (e) {
        console.error('[ZenKit] bus "*" handler threw', e)
      }
    })
  }

  return { on, off, emit }
}

export type ZenBus = ReturnType<typeof createBus>
