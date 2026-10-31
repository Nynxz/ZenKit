import { app } from '@comfy/app'
import { connectLoraManager } from '@/adapters/loraManager'
import { HIDE_TOP_BAR_BUTTON } from '@/adapters/loraManager/topBarButton'
import { ADDRESS_SETTING, connectZenTrainer } from '@/adapters/zenTrainer'

// Zen Integrations — ZenKit surfaces for other node packs, added from outside so those packs
// stay unmodified. Each adapter detects its own target and does nothing when it is absent.
const ADAPTERS: Array<[name: string, connect: () => Promise<void>]> = [
  ['LoRA Manager', connectLoraManager],
  ['ZenTrainer', connectZenTrainer],
]

app.registerExtension({
  name: 'nynxz.zenintegrations',
  settings: [HIDE_TOP_BAR_BUTTON, ADDRESS_SETTING],
  setup() {
    // Not awaited: detection and the ZenKit handshake must not hold up ComfyUI's startup.
    for (const [name, connect] of ADAPTERS)
      connect().catch((error) => console.warn(`[ZenIntegrations] ${name}:`, error))
  },
} as never)
