// Ownership ledger behind window.ZenKit.plugins: registerZenPlugin reports a RegisteredPlugin
// here, and the Zen Inspector reads it back. Tracks who owns what; the surfaces themselves live
// in their own registries.
import { reactive } from 'vue'
import type { RegisteredPlugin, ZenPlugins } from './types'
import type { ZenBus } from './bus'

// Reactive so the Inspector re-renders on (de)register. Re-registering an id replaces it.
const registry = reactive(new Map<string, RegisteredPlugin>())

/** The reactive ledger, for in-bundle components (the Inspector if it ships in core). */
export const pluginRegistry = registry

/** Build the public `plugins` surface over the shared bus. Emits 'plugins:change' on every
 *  mutation so cross-bundle consumers (a separate inspector plugin) can react via the bus. */
export function createPlugins(bus: ZenBus): ZenPlugins {
  const emit = () => bus.emit('plugins:change')
  return {
    register(plugin: RegisteredPlugin): () => void {
      registry.set(plugin.id, plugin)
      emit()
      return () => {
        // Only drop it if it's still the same record (a later re-register wins).
        if (registry.get(plugin.id) === plugin) {
          registry.delete(plugin.id)
          emit()
        }
      }
    },
    registered: () => [...registry.values()],
    get: (id: string) => registry.get(id) ?? null,
  }
}
