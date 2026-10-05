# Themes

A theme pack is JSON: semantic colour tokens for light and/or dark mode, plus optional CSS and a
startup splash. ZenKit applies the active pack to its own UI, to `@nynxz/zenkit-ui` components and
(by default) to ComfyUI itself. Style your plugin from the `--zen-*` tokens and it follows every
theme for free.

## Using the theme in a plugin

```css
.my-panel {
  background: var(--zen-surface);
  color: var(--zen-text);
  border: 1px solid var(--zen-border);
  border-radius: var(--zen-radius);
}
.my-panel .hint {
  color: var(--zen-muted);
  font-family: var(--zen-mono);
}
.my-panel .go {
  background: var(--zen-accent);
  color: var(--zen-accent-text);
}
```

React to switches:

```ts
const zen = await whenZen()
zen?.theme.onChange((pack) => console.log('theme', pack, zen.theme.currentMode()))
```

## Component tokens (`--zen-*`)

What plugins and `@nynxz/zenkit-ui` read. `window.ZenKit.theme.tokens` lists them. They are
derived from the pack's semantic tokens (right column), or from ComfyUI's own palette when the
`comfy` pack is active.

| Token                                                                  | Derived from                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------- |
| `--zen-bg`                                                             | `--background`                                     |
| `--zen-surface`                                                        | `--card`                                           |
| `--zen-surface-2`                                                      | `--secondary`, `--muted`                           |
| `--zen-input`, `--zen-field-bg`                                        | `--input`                                          |
| `--zen-text`                                                           | `--foreground`                                     |
| `--zen-muted`                                                          | `--muted-foreground`                               |
| `--zen-border`, `--zen-surface-border`, `--zen-control-border`         | `--border`                                         |
| `--zen-accent`, `--zen-control-hover-border`, `--zen-ghost-hover-text` | `--primary`                                        |
| `--zen-accent-text`                                                    | black or white, whichever reads best on the accent |
| `--zen-radius`, `--zen-radius-surface`                                 | `--radius`                                         |
| `--zen-chrome-bg`, `--zen-control-bg`, `--zen-control-hover-bg`        | `--card`                                           |
| `--zen-ghost-bg`                                                       | `--background`                                     |
| `--zen-danger`, `--zen-danger-text`                                    | `--destructive`                                    |
| `--zen-warn`, `--zen-warn-text`                                        | `--warning` (default `#d97706`)                    |
| `--zen-ok`, `--zen-ok-text`                                            | `--success` (default `#16a34a`)                    |
| `--zen-info`, `--zen-info-text`                                        | `--info`, else the accent                          |
| `--zen-mono`                                                           | `--font-mono`, else a system monospace stack       |

## Pack tokens

The shadcn-style semantic set a pack defines. Missing ones fall back to neutral dark defaults, so a
pack can set only a few.

`--background` `--foreground` `--card` `--card-foreground` `--popover` `--popover-foreground`
`--primary` `--primary-foreground` `--secondary` `--secondary-foreground` `--muted`
`--muted-foreground` `--accent` `--accent-foreground` `--destructive` `--destructive-foreground`
`--border` `--input` `--ring` `--radius`

Optional extras that ZenKit reads: `--warning`, `--success`, `--info`, `--font-mono`,
`--comfy-menu-bg`. Any other custom property in a pack (e.g. `--sidebar-*`, or your own) is written
to the page too, so pack CSS can use it.

## Theme API

| `window.ZenKit.theme`        | Meaning                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `packs()`                    | Pack ids, `'comfy'` (ComfyUI's own palette) first.                                      |
| `packLabel(id)`              | Display name.                                                                           |
| `packModes(id)`              | `['light']`, `['dark']` or both.                                                        |
| `current()`, `currentMode()` | Active pack id and mode.                                                                |
| `setPack(id)`                | Switch. Unknown ids are ignored; the mode is clamped to one the pack supports.          |
| `setMode(mode)`              | `'light'` or `'dark'`.                                                                  |
| `onChange(cb)`               | Called with the pack id after any pack or mode change. Returns unsubscribe.             |
| `registerPack(pack)`         | Register a `ThemePack`; `false` if invalid. Re-registering the active id re-applies it. |
| `tokens`                     | The `--zen-*` names above.                                                              |

The choice persists in `localStorage` (`zenkit.theme.pack`, `zenkit.theme.mode`).

## Writing a theme pack

Put a folder with a `theme.json` in either place, then reload the browser (no rebuild):

| Folder                                     | Notes                                                         |
| ------------------------------------------ | ------------------------------------------------------------- |
| `custom_nodes/ComfyUI-ZenKit/themes/<id>/` | Built-ins; replaced on plugin update.                         |
| `ComfyUI/user/zenkit/themes/<id>/`         | Your drop-ins; survive updates. Same id overrides a built-in. |

ComfyUI-ZenKit serves the merged list at `GET /zenkit/themes`.

```json
{
  "id": "harbor",
  "name": "Harbor",
  "modes": ["dark"],
  "tokens": {
    "dark": {
      "--background": "#0f1720",
      "--foreground": "#dfe7ef",
      "--card": "#16212c",
      "--primary": "#4fb3bf",
      "--border": "#26394a",
      "--radius": "10px"
    }
  },
  "css": "harbor.css",
  "splash": { "preset": "hearts" }
}
```

| Field                         | Required     | Meaning                                                                                                                                                       |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                          | yes          | Kebab-case, unique.                                                                                                                                           |
| `name`                        | yes          | Shown in pickers.                                                                                                                                             |
| `tokens.light`, `tokens.dark` | at least one | `"--token": "value"` maps. Any CSS colour syntax works, `oklch()` included. Non-string values are dropped.                                                    |
| `modes`                       | no           | Supported modes; derived from which token sets exist when omitted.                                                                                            |
| `css`                         | no           | CSS text, or a filename / list of filenames in the theme folder (the server inlines them; only the basename is used). Injected only while the pack is active. |
| `splash`                      | no           | Startup screen; see below.                                                                                                                                    |

Invalid files are skipped, never fatal.

### Theme CSS and the theming contract

Pack CSS is injected after the tokens, so it can override them. Scope it to these stable hooks and
use `!important` to beat ZenKit's scoped styles:

| Selector                                                                                                          | Matches                                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `html[data-zen-theme-pack="<id>"]`                                                                                | Root while your pack is active (also on `body`). |
| `.zenkit-panel`                                                                                                   | A panel's root.                                  |
| `.zenkit-panel-header`, `.zenkit-panel-title`, `.zenkit-panel-icon`, `.zenkit-panel-button`, `.zenkit-panel-body` | Panel parts.                                     |
| `[data-zen-status="open\|minimized\|folded"]`                                                                     | On `.zenkit-panel`.                              |
| `[data-zen-active="true"]`                                                                                        | The frontmost panel.                             |
| `[data-zen-docked="true"]`, `[data-zen-dock-side="right\|bottom"]`                                                | Docked panels.                                   |
| `[data-zen-tiled]`                                                                                                | Panels tiled in a workspace.                     |
| `[data-zen-frame="none"]`                                                                                         | Bare panels.                                     |
| `[data-zen-interacting="true"]`                                                                                   | The panel being dragged or resized.              |
| `.lg-node`, `.lg-node-header`                                                                                     | ComfyUI's node DOM (Vue nodes).                  |

```css
/* harbor.css */
html[data-zen-theme-pack='harbor'] .zenkit-panel-header {
  border-bottom: 2px solid var(--zen-accent) !important;
}
```

CSS is trusted local content: it can't run script, but `url()` can fetch.

### Startup splash

`splash` sets what ComfyUI shows while loading, from the **next** load (ComfyUI draws it before any
extension runs, so ZenKit stores it in `localStorage` for the next boot).

| Field         | Meaning                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preset`      | A built-in sequence. Currently `"hearts"`.                                                                                                                             |
| `html`, `css` | Your own markup, written into `#splash-loader`. Scope CSS under `#splash-loader`; `var(--splash-accent)` is the pack's primary colour. Takes precedence over `preset`. |

Without `splash`, the pack still gets ComfyUI's logo drawn in its colours. Users can turn themed
startup off in Zen Settings.

## Registering a pack from a plugin

```ts
registerZenPlugin({
  id: 'myplugin',
  plugin: 'My Plugin',
  themes: [
    {
      id: 'myplugin-dusk',
      name: 'Dusk',
      tokens: { dark: { '--background': '#1b1626', '--primary': '#c792ea' } },
      css: '.zenkit-panel-header { letter-spacing: .02em !important; }',
    },
  ],
})
```

Low level: `window.ZenKit.theme.registerPack(pack)`. Here `css` must be CSS text; filename refs are
only resolved for packs on disk.

> Note: the Start menu's theme picker reads the pack list when the taskbar mounts, which is before
> plugins register. A pack registered from a plugin can be applied with `theme.setPack(id)`, but may
> not appear in that picker until the list is re-read. Packs on disk are always listed.
