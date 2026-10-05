<p align="center"><img alt="ZenKit" src="https://raw.githubusercontent.com/Nynxz/ZenKit/main/docs/assets/brand/logo.svg" width="160"></p>

# ZenKit

ZenKit is a UX layer for ComfyUI. It adds dockable panels, a taskbar, full-screen apps and
themes, and gives plugins one shared toolkit (`window.ZenKit`) so they look and work alike.

> These docs describe the upcoming release. Anything marked **unreleased** is not on `main` or
> npm yet.

## Start here

| I want to…                                  | Read                                                |
| ------------------------------------------- | --------------------------------------------------- |
| Install ZenKit and its plugins              | [Installing](Installing.md)                         |
| Add a panel or app to ComfyUI               | [Your first plugin](Your-First-Plugin.md)           |
| Put Vue widgets inside my nodes             | [Nodekit pack pattern](Nodekit-Pack-Pattern.md)     |
| Use the themed components                   | [UI components](UI-Components.md)                   |
| Make my plugin work when ZenKit isn't there | [Working without ZenKit](Working-Without-ZenKit.md) |
| Know which package to import                | [Packages](Packages.md)                             |

## Guides

- [Panels and workspaces](Panels-and-Workspaces.md): floating, docked and tiled windows, taskbar widgets
- [Apps and routing](Apps-and-Routing.md): full-screen apps with their own routes
- [Themes](Themes.md): tokens, theme packs and writing your own
- [Backgrounds](Backgrounds.md): canvas backgrounds, finishes and effects
- [Channels and media](Channels-and-Media.md): the media bus, media refs, drag and drop, the viewer
- [Jobs](Jobs.md): progress for long-running work, from Python or TypeScript
- [Capabilities](Capabilities.md): actions other plugins and agents can call
- [Storage and bus](Storage-and-Bus.md): persistence, events and branding

## Reference

- [API reference](API-Reference.md): every `window.ZenKit` member and `@nynxz/zenkit-client` export
- [UI components](UI-Components.md): props, events and slots for `@nynxz/zenkit-ui`
- [Plugins](Plugins.md): what ships in this repo
- [Contributing](Contributing.md): repo layout, dev loop and releases

> These pages are generated from [`docs/wiki`](https://github.com/Nynxz/ZenKit/tree/main/docs/wiki)
> in the main repo. Edit them there; changes made directly in the wiki get overwritten.
