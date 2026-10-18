// Undo/redo for an editor whose state is plain data. Each `record()` keeps a snapshot of the
// state as it is NOW, so a host records once per finished gesture (a box canvas's `commit`), never
// per pointermove. Snapshots are JSON copies: the state must be JSON-shaped, which is also what
// lets one be saved on a node.
import { computed, shallowRef, type ComputedRef } from 'vue'

export interface History {
  /** Keep the current state as the newest step. A no-op if nothing changed since the last one. */
  record(): void
  /** Step back one; false if there was nothing to undo. */
  undo(): boolean
  /** Step forward one; false if there was nothing to redo. */
  redo(): boolean
  /** Forget every step and start again from the current state — after a load or a reset. */
  reset(): void
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>
}

export interface HistoryOptions<T> {
  /** The state as it is now. */
  read: () => T
  /** Put a snapshot back. Receives a fresh copy the history no longer holds. */
  write: (state: T) => void
  /** Steps kept; the oldest go first. */
  limit?: number
}

export function createHistory<T>({ read, write, limit = 80 }: HistoryOptions<T>): History {
  const snap = () => JSON.stringify(read())
  const steps = shallowRef<string[]>([snap()])
  const at = shallowRef(0)

  function restore(index: number) {
    at.value = index
    write(JSON.parse(steps.value[index]!) as T)
  }

  return {
    record() {
      const now = snap()
      if (now === steps.value[at.value]) return
      const kept = [...steps.value.slice(0, at.value + 1), now]
      const dropped = Math.max(0, kept.length - Math.max(1, limit) - 1)
      steps.value = kept.slice(dropped)
      at.value = steps.value.length - 1
    },
    undo() {
      if (at.value <= 0) return false
      restore(at.value - 1)
      return true
    },
    redo() {
      if (at.value >= steps.value.length - 1) return false
      restore(at.value + 1)
      return true
    },
    reset() {
      steps.value = [snap()]
      at.value = 0
    },
    canUndo: computed(() => at.value > 0),
    canRedo: computed(() => at.value < steps.value.length - 1),
  }
}
