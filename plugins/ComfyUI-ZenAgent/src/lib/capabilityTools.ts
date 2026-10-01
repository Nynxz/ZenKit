import { getZenKit } from '@nynxz/zenkit-client'

import type { CapabilityTool } from './api'

// Every ZenKit capability is offered to the model as a tool. Tool names can't hold dots, so
// `viewer.show` is offered as `viewer_show`; this maps the names back when the model calls one.

const toolName = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)

let byName = new Map<string, string>()

/** The capabilities registered right now, as tools for the next turn. */
export function capabilityTools(): CapabilityTool[] {
  const capabilities = getZenKit()?.capabilities.list() ?? []
  byName = new Map(capabilities.map((c) => [toolName(c.id), c.id]))
  return capabilities.map((c) => ({
    name: toolName(c.id),
    description: c.description,
    parameters: c.params ?? { type: 'object', properties: {} },
    effect: c.effect ?? 'read',
  }))
}

/** The capability id behind a tool name, if it is one. */
export const capabilityFor = (name: string): string | undefined => byName.get(name)
