// zen.capabilities — named actions plugins offer each other and agents. A capability is plain
// data plus `run`; agents turn every registered one into a tool, so installing a plugin is
// what teaches an agent a new skill.
import type { Capability, CapabilityInfo, ZenCapabilities } from './types'
import type { ZenBus } from './bus'
import { zwarn } from './log'

const ID = /^[a-z][\w-]*(\.[a-z][\w-]*)+$/i

const infoOf = ({ run: _run, ...info }: Capability): CapabilityInfo => info

export function createCapabilities(bus: ZenBus): ZenCapabilities {
  const byId = new Map<string, Capability>()
  const changed = () => bus.emit('capabilities:change')

  function register(capability: Capability): () => void {
    if (!ID.test(capability.id)) {
      zwarn(`capability "${capability.id}" ignored: ids are "<plugin>.<action>"`)
      return () => {}
    }
    byId.set(capability.id, capability)
    changed()
    return () => {
      if (byId.get(capability.id) !== capability) return
      byId.delete(capability.id)
      changed()
    }
  }

  async function run(id: string, args: Record<string, unknown> = {}, opts: { signal?: AbortSignal } = {}) {
    const capability = byId.get(id)
    if (!capability) throw new Error(`No capability "${id}".`)
    const missing = (capability.params?.required ?? []).filter((name) => args[name] === undefined)
    if (missing.length) throw new Error(`${id} needs ${missing.join(', ')}.`)
    return capability.run(args, { signal: opts.signal ?? new AbortController().signal })
  }

  return {
    register,
    list: () => [...byId.values()].map(infoOf),
    get: (id) => {
      const capability = byId.get(id)
      return capability ? infoOf(capability) : null
    },
    run,
    onChange: (cb) => bus.on('capabilities:change', () => cb()),
  }
}
