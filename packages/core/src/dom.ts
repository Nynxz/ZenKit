// Tiny DOM helpers for managed `<style>` injection. One `<style>` per id, content
// replaced in place (idempotent), so callers can re-apply freely without piling up
// duplicate tags. Shared by the theme bridge and the chrome toggles (sidebar
// autohide, comfy-bar hide, …) so there's a single injection pattern.

/** Ensure a `<style id>` exists in `<head>` holding exactly `content` (created on
 *  first call, updated in place after — a no-op when unchanged). Returns the element. */
export function ensureStyle(id: string, content: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  if (el.textContent !== content) el.textContent = content
  return el
}

/** Remove a managed `<style id>` if present (for styles that toggle fully off). */
export function removeStyle(id: string): void {
  document.getElementById(id)?.remove()
}
