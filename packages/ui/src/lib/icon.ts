// A panel/registration `icon` may be either an MDI class (e.g. "mdi mdi-movie")
// or an image URL / data URI (a custom favicon or logo). isIconUrl() decides which,
// so chrome can render an <img> instead of the icon font.

export function isIconUrl(icon?: string | null): boolean {
  if (!icon) return false
  const s = icon.trim()
  if (!s || s.includes(' ')) return false // MDI classes contain a space ("mdi mdi-x")
  return (
    /^(https?:|data:|blob:|\/)/i.test(s) ||
    /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)(\?|#|$)/i.test(s)
  )
}
