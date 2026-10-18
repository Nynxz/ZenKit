import type { PanelContext } from '@nynxz/zenkit-client'
import { isLoraManagerPath, LM_HOME } from './routes'

// The LoRA Manager UI is a server-rendered multi-page site (Jinja templates under
// templates/, assets under /loras_static) with its own header nav. It is embedded whole,
// in an iframe, rather than reimplemented as ZenKit components:
//
//   • It is same-origin, so nothing is lost to frame boundaries — its /api/lm/* calls,
//     websockets and cookies all behave exactly as they do in a browser tab.
//   • "Send to workflow" already round-trips through the backend
//     (/api/lm/update-lora-code + web/comfyui/workflow_registry.js), so it targets the
//     live graph from inside the panel with no cross-frame plumbing.
//   • The site holds no references to window.top/parent/opener, so embedding needs no
//     changes on the LoRA Manager side. This integration is purely additive.

/** Read the page a previous session left this panel instance on, if it is still valid. */
function restorePath(ctx?: PanelContext): string {
  const saved = (ctx?.state as { path?: unknown } | undefined)?.path
  return isLoraManagerPath(saved) ? saved : LM_HOME
}

/** Fill a ZenKit panel body with the LoRA Manager site. Returns the panel's cleanup. */
export function mountLoraManager(el: HTMLElement, ctx?: PanelContext): () => void {
  el.style.width = '100%'
  el.style.height = '100%'
  el.style.overflow = 'hidden'

  const frame = document.createElement('iframe')
  frame.src = restorePath(ctx)
  frame.title = 'LoRA Manager'
  // Fills the panel body and follows every resize; the ZenKit surface token keeps the
  // gap behind a still-loading document from flashing white on a dark theme.
  frame.style.cssText =
    'display:block;width:100%;height:100%;border:0;background:var(--zen-surface,#1b1e24)'
  // Same-origin frames inherit these by default; naming them documents what the site
  // needs (copy trigger words / LoRA syntax) and survives a stricter parent policy.
  frame.allow = 'clipboard-read; clipboard-write'

  // Remember where the user navigated to, so reopening the panel — or reloading ComfyUI
  // entirely — comes back to that page instead of resetting to /loras. Reading the
  // iframe's location is legal because it is same-origin; it is still guarded, since a
  // navigation elsewhere would make it throw.
  const remember = () => {
    if (!ctx) return
    try {
      const win = frame.contentWindow
      if (!win) return
      const path = win.location.pathname + win.location.search
      if (isLoraManagerPath(path)) ctx.setState({ path })
    } catch {
      /* cross-origin document or a torn-down frame — nothing worth persisting */
    }
  }
  frame.addEventListener('load', remember)

  el.appendChild(frame)

  return () => {
    frame.removeEventListener('load', remember)
    frame.remove()
  }
}
