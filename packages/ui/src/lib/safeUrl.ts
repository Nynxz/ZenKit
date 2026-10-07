// URLs that come from outside — a LoRA's .metadata.json, a lightbox item a caller passes in — are
// untrusted: a `javascript:` or `data:text/html` URL in a link runs code when clicked. These check
// one before it goes into a src or an href.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const MEDIA_DATA = /^data:(image|video|audio)\/[a-z0-9.+-]+[;,]/i

function protocolOf(u: string): string | null {
  try {
    return new URL(u, location.href).protocol
  } catch {
    return null
  }
}

/** `u` when it's safe to load as media or offer as a download: http(s), blob:, a path on this
 *  origin, or a data: URL of an image, video or sound. Null for anything else (javascript:,
 *  vbscript:, data:text/html, …). The URL parser's own rules decide the scheme, so tabs or
 *  newlines hidden inside one don't slip past. */
export function safeMediaUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  const s = u.trim()
  if (!s) return null
  if (/^data:/i.test(s)) return MEDIA_DATA.test(s) ? s : null
  const protocol = protocolOf(s)
  const allowed = SCHEME.test(s) ? ['http:', 'https:', 'blob:'] : ['http:', 'https:']
  return protocol && allowed.includes(protocol) ? s : null
}

/** `u` when it's a web page to open (http or https), else null — for "view on the web" links. */
export function safeLinkUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null
  const protocol = protocolOf(u.trim())
  return protocol === 'http:' || protocol === 'https:' ? u.trim() : null
}
