/** Where ZenTrainer's app lives on whichever ComfyUI serves it. */
export const ZT_BASE = '/zentrainer/'

/** The port `zt start` takes when it is free. */
export const ZT_PORT = 8189

/** The ZenTrainer app's root URL from the address setting: blank for this ComfyUI, a port
 *  ("8190") for this host on that port, or an http(s) address ("http://host:8190"), of which
 *  only the origin is kept. Null for anything else. */
export function appUrl(setting: unknown, here: URL): URL | null {
  const value = typeof setting === 'string' ? setting.trim() : ''
  if (!value) return new URL(ZT_BASE, here.origin)
  if (/^\d{1,5}$/.test(value)) {
    const port = Number(value)
    if (port < 1 || port > 65535) return null
    return new URL(ZT_BASE, `${here.protocol}//${here.hostname}:${port}`)
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return new URL(ZT_BASE, url.origin)
  } catch {
    return null
  }
}

/** True for a page of the ZenTrainer app (not its API), as a bare absolute path.
 *
 *  Panel state comes back from storage, so it isn't trusted: this keeps a corrupted or
 *  hand-edited state from pointing the panel's iframe anywhere else. */
export function isZenTrainerPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!path.startsWith(ZT_BASE) || path.startsWith('//')) return false
  // Judge the path the iframe will actually load: the URL parser resolves dot segments, %2e%2e
  // and backslashes included, so `/zentrainer/%2e%2e/x` is `/x`. The API test also looks at the
  // decoded form (`%61pi` is `api` to the server).
  let pathname: string
  try {
    pathname = new URL(path, 'http://zentrainer.invalid').pathname
  } catch {
    return false
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return false
  }
  return (
    pathname.startsWith(ZT_BASE) &&
    !pathname.startsWith(`${ZT_BASE}api/`) &&
    !decoded.startsWith(`${ZT_BASE}api/`)
  )
}
