// Detach a registered panel into a separate OS window. Both paths load THIS page with a
// `?zen-panel=<id>` flag, where ZenKit's secondary mode (installZenKitSecondary) boots a
// minimal runtime and mounts just that panel fullscreen — so the panel is a real, live,
// styled instance, not a snapshot. Desktop uses comfy-desktop's native secondary window
// (window.__comfyDesktop2.SecondaryWindow); the browser falls back to window.open. The only
// environment-specific bit is which "open a window" call we make.

interface DesktopSecondary {
  open: (o: { id: string; title?: string; width?: number; height?: number; url?: string }) => void
}
function desktopSecondary(): DesktopSecondary | null {
  const d = (window as unknown as { __comfyDesktop2?: { SecondaryWindow?: DesktopSecondary } })
    .__comfyDesktop2
  return d?.SecondaryWindow ?? null
}

/** Is a detached panel window even possible here? (desktop, or a browser that allows popups) */
export function detachSupported(): boolean {
  return true // desktop → native window; browser → window.open (popup blockers aside)
}

/** Open `panelId` (a registration id) in its own window — a live, styled instance via the
 *  secondary runtime. The panel stays open in the app too (this opens a second view, it
 *  doesn't move the panel out). Desktop uses comfy-desktop's native window; browser falls
 *  back to window.open. */
export function detachPanel(panelId: string, title?: string): void {
  const url = location.origin + location.pathname + '?zen-panel=' + encodeURIComponent(panelId)
  const winId = 'zen-panel-' + panelId
  const sw = desktopSecondary()
  if (sw) {
    sw.open({ id: winId, title: title ?? panelId, width: 760, height: 580, url })
  } else {
    window.open(url, winId, 'width=760,height=580')
  }
}
