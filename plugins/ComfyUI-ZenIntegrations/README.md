# ComfyUI-ZenIntegrations

ZenKit panels and job progress for other node packs, added from outside so those packs stay
unmodified. Requires [ComfyUI-ZenKit](../ComfyUI-ZenKit).

Each adapter checks whether its pack is installed and does nothing when it is not. Adapters use
only what the pack already serves (HTTP routes, websockets, pages), never its internals.

| Pack                                                             | Adds                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [LoRA Manager](https://github.com/willmiao/ComfyUI-Lora-Manager) | The LoRA Manager site as a panel (`loramanager:browser`); startup and manual library scans as ZenKit jobs.                        |
| [ZenTrainer](https://github.com/Nynxz/ZenTrainer)                | The training app as a panel (`zentrainer:app`), from this ComfyUI or a standalone `zt start` (port 8189, or the address setting). |

## Adding an adapter

Add `src/adapters/<pack>/` exporting a `connect…()` that detects the pack (e.g. a route it
serves) and calls `registerZenPlugin` under the pack's own identity, then list it in
`src/main.ts`.

## Build

```sh
pnpm --filter comfyui-zenintegrations build
```
