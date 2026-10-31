import type { PanelContext } from '@nynxz/zenkit-client'
import { isZenTrainerPath } from './routes'

// ZenTrainer's web app is its own Vue site under /zentrainer/, embedded whole in an iframe like
// LoRA Manager's. On this ComfyUI it is same-origin, and the panel remembers the page it was on.
// Run on its own ComfyUI (`zt start`, another port) it is a different origin: it still works,
// it talks to its own server, but the page it was on can't be read, so it opens on the app's
// home page.

/** Whether anything answers at `url`. Cross-origin, the response is opaque: only a network
 *  failure tells us nothing is there. */
export async function reachable(url: URL, timeoutMs = 2000): Promise<boolean> {
  const sameOrigin = url.origin === location.origin
  try {
    const response = await fetch(new URL('api/health', url), {
      mode: sameOrigin ? 'same-origin' : 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return !sameOrigin || response.ok
  } catch {
    return false
  }
}

function startUrl(app: URL, ctx?: PanelContext): string {
  if (app.origin !== location.origin) return app.href
  const saved = (ctx?.state as { path?: unknown } | undefined)?.path
  return isZenTrainerPath(saved) ? new URL(saved, app.origin).href : app.href
}

function frameFor(app: URL, ctx?: PanelContext): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.src = startUrl(app, ctx)
  frame.title = 'ZenTrainer'
  frame.style.cssText =
    'display:block;width:100%;height:100%;border:0;background:var(--zen-surface,#1b1e24)'
  frame.allow = 'clipboard-read; clipboard-write; fullscreen'
  frame.addEventListener('load', () => {
    if (!ctx) return
    try {
      const win = frame.contentWindow
      if (!win) return
      const path = win.location.pathname + win.location.search
      if (isZenTrainerPath(path)) ctx.setState({ path })
    } catch {
      /* another origin, or a torn-down frame */
    }
  })
  return frame
}

function notRunning(app: URL, retry: () => void): HTMLElement {
  const box = document.createElement('div')
  box.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
    'height:100%;padding:24px;text-align:center;color:var(--zen-muted,#9aa0aa);font-size:13px'
  const line = document.createElement('div')
  line.textContent = `ZenTrainer isn't answering at ${app.href}. Start it (zt start), or set its address in Settings → Zen Integrations → ZenTrainer.`
  const button = document.createElement('button')
  button.textContent = 'Try again'
  button.style.cssText =
    'padding:4px 12px;border:1px solid var(--zen-border,#34343c);border-radius:var(--zen-radius,6px);' +
    'background:var(--zen-control-bg,transparent);color:var(--zen-text,#e5e5ea);cursor:pointer'
  button.addEventListener('click', retry)
  box.append(line, button)
  return box
}

/** Fill a ZenKit panel body with the ZenTrainer app at `app`. Returns the panel's cleanup. */
export function mountZenTrainer(app: URL) {
  return (el: HTMLElement, ctx?: PanelContext): (() => void) => {
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.overflow = 'hidden'
    let gone = false
    const show = async () => {
      const up = await reachable(app)
      if (gone) return
      el.replaceChildren(up ? frameFor(app, ctx) : notRunning(app, () => void show()))
    }
    void show()
    return () => {
      gone = true
      el.replaceChildren()
    }
  }
}
