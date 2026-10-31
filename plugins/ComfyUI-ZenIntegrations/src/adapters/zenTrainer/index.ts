import { app } from '@comfy/app'
import { registerZenPlugin } from '@nynxz/zenkit-client'
import { ZT_ICON, ZT_LOGO } from './logo'
import { mountZenTrainer, reachable } from './panel'
import { appUrl, ZT_BASE, ZT_PORT } from './routes'

// ZenTrainer (Nynxz/ZenTrainer): its training app as a ZenKit panel. Installed in this ComfyUI it
// is found at /zentrainer/; run on its own (`zt start`) it is looked for on port 8189 of this
// host (and of 127.0.0.1), or wherever the address setting says. Its runs reach ZenKit's taskbar
// on their own (the engine sends zenkit.job events) when it shares this ComfyUI.

export const ADDRESS_SETTING = {
  id: 'zenintegrations.zentrainer.address',
  name: 'Address',
  category: ['Zen Integrations', 'ZenTrainer', 'Address'],
  type: 'text',
  defaultValue: '',
  tooltip:
    `Where ZenTrainer runs: blank finds it in this ComfyUI or on port ${ZT_PORT} of this ` +
    'host or 127.0.0.1; a port (8190) or an address (http://127.0.0.1:8190) points the panel there. ' +
    'Takes effect on reload.',
}

const settingValue = (id: string): unknown =>
  (
    app as unknown as { extensionManager?: { setting?: { get: (id: string) => unknown } } }
  ).extensionManager?.setting?.get(id)

/** Where a standalone ZenTrainer may be: this host on its port, and loopback too when ComfyUI
 *  was opened on another address (a LAN IP), since `zt start` listens on 127.0.0.1. */
export function standaloneCandidates(here: URL): URL[] {
  const onHost = appUrl(String(ZT_PORT), here)!
  const loopback = new URL(ZT_BASE, `http://127.0.0.1:${ZT_PORT}`)
  return onHost.origin === loopback.origin ? [onHost] : [onHost, loopback]
}

/** Where the panel should point, or null when there's no ZenTrainer to show. A set address is
 *  trusted even while nothing answers there: the panel says so and offers to try again. */
async function locate(): Promise<URL | null> {
  const here = new URL(location.href)
  const configured = settingValue(ADDRESS_SETTING.id)
  if (typeof configured === 'string' && configured.trim()) return appUrl(configured, here)
  const local = appUrl('', here)!
  if (await reachable(local)) return local
  for (const standalone of standaloneCandidates(here))
    if (standalone.origin !== here.origin && (await reachable(standalone, 1500))) return standalone
  return null
}

export async function connectZenTrainer(): Promise<void> {
  const url = await locate()
  if (!url) return
  await registerZenPlugin({
    id: 'zentrainer',
    plugin: 'ZenTrainer',
    description: 'Train LoRAs on the models ComfyUI already has, and watch them learn.',
    logo: ZT_LOGO,
    panels: [
      {
        id: 'app', // → 'zentrainer:app'
        title: 'ZenTrainer',
        icon: ZT_ICON,
        render: mountZenTrainer(url),
        width: 1320,
        height: 860,
        minWidth: 640,
        minHeight: 440,
      },
    ],
  })
}
