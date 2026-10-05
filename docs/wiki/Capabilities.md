# Capabilities

A capability is a named action your plugin offers to other plugins and to agents. An agent sees
every registered capability as a tool, so installing a plugin is what teaches the agent a new
skill.

## Minimal example

```ts
import { registerZenPlugin } from '@nynxz/zenkit-client'

registerZenPlugin({
  id: 'stash',
  plugin: 'Stash',
  capabilities: [
    {
      id: 'search', // becomes 'stash.search'
      description:
        'Search the stash for images by tag. Returns up to `limit` media refs, newest first.',
      params: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'A tag, e.g. "portrait"' },
          limit: { type: 'number', description: 'Default 10' },
        },
        required: ['tag'],
      },
      run: async ({ tag, limit }, { signal }) => {
        const res = await fetch(`/stash/search?tag=${encodeURIComponent(String(tag))}`, { signal })
        const ids: string[] = await res.json()
        return { media: ids.slice(0, Number(limit ?? 10)).map((id) => `stash:${id}`) }
      },
    },
  ],
})
```

Anyone can then call it:

```ts
const result = await zen.capabilities.run('stash.search', { tag: 'portrait' })
```

## `Capability`

| Field            | Type                   | Meaning                                                                                                                                                                                                |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | `string`               | `<plugin>.<action>`. In `registerZenPlugin`, an id without a `.` gets your plugin id prepended; one with a `.` is kept. Must match `/^[a-z][\w-]*(\.[a-z][\w-]*)+$/i` or it is ignored with a warning. |
| `description`    | `string`               | Written for the caller. An agent reads exactly this, so say what it does, what the args mean and what it returns.                                                                                      |
| `params`         | `CapabilitySchema`     | JSON Schema for the args: `{ type: 'object', properties?, required? }`.                                                                                                                                |
| `effect`         | `'read' \| 'write'`    | `read` (default) only looks; `write` changes something (graph, files, panels).                                                                                                                         |
| `plugin`         | `string`               | Owning plugin id; `registerZenPlugin` fills it in.                                                                                                                                                     |
| `run(args, ctx)` | `unknown` or a promise | Return something JSON-able. Throw to fail.                                                                                                                                                             |

`ctx.signal` is an `AbortSignal` the caller may abort; pass it to `fetch` and check it in loops.

Return media as [media refs](Channels-and-Media.md#media-refs) (`output/…`, `stash:…`) rather than
URLs, so the result can be passed on to `viewer.show`, `media.view` or a loader input.

## API

| `window.ZenKit.capabilities`  | Meaning                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `register(cap)`               | Add or replace by id. Returns unregister.                                                                                            |
| `list()`                      | `CapabilityInfo[]` (everything but `run`).                                                                                           |
| `get(id)`                     | `CapabilityInfo \| null`.                                                                                                            |
| `run(id, args?, { signal? })` | Rejects if the id is unknown, a `required` arg is `undefined`, or `run` throws. Only `required` is checked; types are not validated. |
| `onChange(cb)`                | Called when capabilities are added or removed. Also on the bus as `capabilities:change`.                                             |

There is no client wrapper; use `registerZenPlugin({ capabilities })` to register, and `whenZen()`
to call.

## How agents see them

ZenKit's agent panel (in progress) sends `capabilities.list()` with every turn:

| Capability        | Agent tool                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`              | Tool name, with characters outside `[A-Za-z0-9_-]` replaced by `_` (`stash.search` → `stash_search`), max 64 chars |
| `description`     | Tool description                                                                                                   |
| `params`          | Tool parameters (an empty object schema when omitted)                                                              |
| `effect: 'write'` | Counts as "the agent changed something" for the turn                                                               |

A capability whose tool name collides with one of the agent's built-in tools is dropped. The
result, or the thrown error's message, goes back to the model as `{ ok, result }` /
`{ ok: false, error }`.

## Built-in capabilities

| Id                                                           | Effect | Does                                                                          |
| ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| `panels.list`                                                | read   | Panel types and open panels, with each one's `describe()` state and commands. |
| `panels.open`                                                | write  | Open a panel type (a new instance for multi types).                           |
| `panels.arrange`                                             | write  | Move, resize, dock, rename, focus, minimize, maximize or close a panel.       |
| `panels.command`                                             | write  | Run a panel's exposed command.                                                |
| `media.list`                                                 | read   | List output or input files as media refs.                                     |
| `media.view`                                                 | read   | Show media refs in the full-screen viewer.                                    |
| `workflows.list`, `workflows.templates`                      | read   | Saved workflows and templates.                                                |
| `workflows.open`, `workflows.new`, `workflows.open_template` | write  | Open or create workflows.                                                     |

ComfyUI-ZenSuite adds `viewer.show` and `viewer.merge` for its Media Viewer.

## Capabilities vs. panel commands

|                 | Capability                                    | Panel command                            |
| --------------- | --------------------------------------------- | ---------------------------------------- |
| Lives           | For the session                               | While that panel is mounted              |
| Scope           | Plugin-wide                                   | One panel instance                       |
| Registered with | `capabilities.register` / `registerZenPlugin` | `ctx.expose({ describe, commands })`     |
| Agents reach it | Directly, as a tool                           | Through `panels.list` + `panels.command` |

Use a panel command for "do this to the thing on screen" (select an item, change a tab), and a
capability for anything that should work whether or not a panel is open. A capability can open a
panel and then drive it with `handle.run(command, args)`; that is how `viewer.show` works. See
[Panels and workspaces](Panels-and-Workspaces.md#panelcontext).
