// Built-in taskbar widgets and their mount lifecycles.
import { createApp, watch } from 'vue'
import { ensureStyle, removeStyle } from './dom'
import { theme } from './theme'
import type { PanelStore } from './panelStore'
import type { AppStore } from './appStore'
import { setStatsPinned } from './tiling'
import { CANVAS_CONTROLS_WIDGET, registerTaskbarWidget } from './taskbarWidgets'
import ZenJobsWidget from './components/ZenJobsWidget.vue'
import ZenRunWidget from './components/ZenRunWidget.vue'

export function registerBuiltinTaskbarWidgets(store: PanelStore, appStore: AppStore): void {
  // Built-in widget: progress for running jobs (invisible while there are none).
  registerTaskbarWidget({
    id: 'zenkit:jobs',
    label: 'Jobs',
    icon: 'mdi mdi-progress-clock',
    order: 90,
    defaultOn: true,
    render: (el) => {
      const widget = createApp(ZenJobsWidget)
      widget.mount(el)
      return () => widget.unmount()
    },
  })

  // Built-in widget: Run / Stop, shown while a workspace or an app covers ComfyUI's action bar.
  registerTaskbarWidget({
    id: 'zenkit:run',
    label: 'Run (when the graph is covered)',
    icon: 'mdi mdi-play',
    order: 80,
    defaultOn: true,
    render: (el) => {
      const widget = createApp(ZenRunWidget, { appStore })
      widget.mount(el)
      return () => widget.unmount()
    },
  })

  // Built-in widget: the hide-all-panels toggle.
  registerTaskbarWidget({
    id: 'zenkit:hide-panels',
    label: 'Hide panels',
    icon: 'mdi mdi-eye-outline',
    order: 100,
    defaultOn: true,
    render: (el) => {
      const btn = document.createElement('button')
      btn.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;width:28px;height:24px;padding:0;background:none;border:none;border-radius:var(--zen-radius,6px);cursor:pointer;font-size:16px;'
      el.appendChild(btn)
      const sync = () => {
        const h = store.state.panelsHidden
        btn.innerHTML = `<i class="mdi ${h ? 'mdi-eye-off-outline' : 'mdi-eye-outline'}"></i>`
        btn.style.color = h ? 'var(--zen-accent, #3b82f6)' : 'var(--zen-muted, #9aa0aa)'
        btn.title = h ? 'Show panels' : 'Hide all panels'
      }
      btn.addEventListener(
        'mouseenter',
        () => (btn.style.background = 'color-mix(in srgb, var(--zen-text, #fff) 12%, transparent)'),
      )
      btn.addEventListener('mouseleave', () => (btn.style.background = 'none'))
      btn.addEventListener('click', () => (store.state.panelsHidden = !store.state.panelsHidden))
      sync()
      const stopWatch = watch(() => store.state.panelsHidden, sync)
      return () => {
        stopWatch()
        btn.remove()
      }
    },
  })

  // Built-in widget: ComfyUI's bottom-right canvas controls, reparented into the taskbar.
  registerTaskbarWidget({
    id: CANVAS_CONTROLS_WIDGET,
    label: 'Canvas controls',
    icon: 'mdi mdi-tune-variant',
    order: 110,
    defaultOn: true,
    render: (el) => {
      // Found by its buttons' test ids (stable across ComfyUI layout changes), not its classes.
      const SEL = '[role="toolbar"]:has([data-testid="zoom-controls-button"])'
      let ctl: HTMLElement | null = null
      let parent: Node | null = null
      let next: Node | null = null
      const dock = () => {
        if (!theme.comfyRestyle()) return
        const c = document.querySelector(SEL) as HTMLElement | null
        if (!c || el.contains(c)) return
        parent = c.parentNode
        next = c.nextSibling
        c.classList.add('zen-canvasctl')
        el.appendChild(c)
        ctl = c
      }
      const undock = () => {
        if (!ctl) return
        ctl.classList.remove('zen-canvasctl')
        if (parent) parent.insertBefore(ctl, next?.parentNode === parent ? next : null)
        ctl = parent = next = null
      }
      const styleId = 'zenkit-canvasctl-style'
      const applyRestyle = (on: boolean) => {
        setStatsPinned(on)
        if (!on) {
          undock()
          removeStyle(styleId)
          return
        }
        ensureStyle(
          styleId,
          `.minimap-main-container{bottom:0!important}${SEL}:not(.zen-canvasctl){display:none!important}`,
        )
        dock()
      }
      applyRestyle(theme.comfyRestyle())
      const offRestyle = theme.onComfyRestyleChange(applyRestyle)
      const retries = [150, 400, 900, 1800, 3000].map((t) =>
        window.setTimeout(() => {
          if (!ctl || !ctl.isConnected || !el.contains(ctl)) dock()
        }, t),
      )
      let frame: number | null = null
      const obs = new MutationObserver(() => {
        if (frame !== null) return
        frame = requestAnimationFrame(() => {
          frame = null
          if (!ctl || !ctl.isConnected || !el.contains(ctl)) dock()
        })
      })
      obs.observe(document.body, { childList: true, subtree: true })
      return () => {
        setStatsPinned(false)
        offRestyle()
        retries.forEach((t) => clearTimeout(t))
        obs.disconnect()
        if (frame !== null) cancelAnimationFrame(frame)
        undock()
        removeStyle(styleId)
      }
    },
  })
}
