/** ComfyUI setting holding the extra host names the request guard allows (a reverse proxy's). */
export const ALLOWED_HOSTS_SETTING = 'ZenKit.Security.AllowedHosts'

const CLAIMED = '__zenkitAllowedHostsSetting'

/** The setting's definition for the first extension that asks, so it's registered once however
 *  many ZenKit packs are installed; an empty list for the rest. */
export function allowedHostsSetting(): Record<string, unknown>[] {
  const g = globalThis as Record<string, unknown>
  if (g[CLAIMED]) return []
  g[CLAIMED] = true
  return [
    {
      id: ALLOWED_HOSTS_SETTING,
      category: ['ZenKit', 'Security', 'Allowed host names'],
      name: 'Allowed host names',
      tooltip:
        'Names a reverse proxy serves ComfyUI under (comma-separated, e.g. comfy.example.com). ' +
        'ZenKit packs refuse changes from any other host while ComfyUI listens only on loopback ' +
        'or one address.',
      type: 'text',
      defaultValue: '',
    },
  ]
}
