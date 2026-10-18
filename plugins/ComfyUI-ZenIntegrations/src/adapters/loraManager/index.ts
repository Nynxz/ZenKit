import { registerZenPlugin, startJob, type ZenPanelDef } from '@nynxz/zenkit-client'
import { mountLoraManager } from './panel'
import { createScanJobs, initUpdate, listen, scanUpdate } from './progress'

// LoRA Manager (willmiao/ComfyUI-Lora-Manager): its web UI as a ZenKit panel, and its library
// scans as ZenKit jobs. Uses only what LoRA Manager already serves, so it works against the
// unmodified pack.

const LOGO = '/loras_static/images/favicon-32x32.png'

const PANEL: ZenPanelDef = {
  id: 'browser', // → 'loramanager:browser'
  title: 'LoRA Manager',
  icon: LOGO,
  render: mountLoraManager,
  // Roomy enough for the folder sidebar plus a few columns of cards at the default size.
  width: 1280,
  height: 840,
  // The site switches to its narrow layout under 768px, so it stays usable well below that.
  minWidth: 560,
  minHeight: 420,
}

/** LoRA Manager's version, or null when it isn't installed. */
async function detect(): Promise<string | null> {
  try {
    const response = await fetch('/api/lm/version-info')
    if (!response.ok) return null
    const data = await response.json()
    return data?.success && typeof data.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

export async function connectLoraManager(): Promise<void> {
  const version = await detect()
  if (version === null) return

  // Registered under LoRA Manager's identity, not this pack's: the panel is LoRA Manager's
  // and is listed under it in the Start menu.
  const { connected } = await registerZenPlugin({
    id: 'loramanager',
    plugin: 'LoRA Manager',
    version,
    description:
      'Browse, organise and enrich LoRAs, checkpoints, embeddings and recipes, and send them straight to the graph.',
    logo: LOGO,
    panels: [PANEL],
  })
  if (!connected) return

  const report = createScanJobs(startJob)
  listen('/ws/init-progress', (payload) => {
    const update = initUpdate(payload)
    if (update) report(update)
  })
  listen('/ws/fetch-progress', (payload) => {
    const update = scanUpdate(payload)
    if (update) report(update)
  })
}
