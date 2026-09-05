// ZenKit theme switcher in ComfyUI's logo menu.
//
// The "ZenKit Themes" entry is a real ComfyUI menu command, so PrimeVue renders and
// state-manages it (native highlighting, survives ComfyUI updates). We only attach a hover
// handler to its rendered DOM to open our own popup.

import { theme } from './theme'
import type { ThemeMode } from './theme'
import { listComfyPalettes, getComfyPalette, applyComfyPalette } from './comfyTheme'

const MENU_SEL = '.comfy-command-menu'
const ITEM_LABEL = 'ZenKit Themes' // matches the command label registered in the plugin
const WIRED = 'data-zen-themes-wired' // our native item, once hover-wired
const COMFY_MARK = 'data-zen-comfy-theme' // ComfyUI's native "Theme" <li>, once tagged
const STYLE_ID = 'zenkit-comfy-thememenu-style'
const POPUP_ID = 'zenkit-theme-popup'
const CLOSE_DELAY = 140 // hover-intent grace when moving between the item and the popup

const STYLE = `
/* a right chevron on our native item so it reads as "opens something" */
[${WIRED}] .p-menubar-item-link::after { content:'\\203A'; margin-left:auto; opacity:.65; font-size:14px; line-height:1; }

/* Styled with the ZenKit theme tokens (the same ones the panels use) so it matches the
   active theme — not ComfyUI's own menu vars, which may be unset or off-theme. */
#${POPUP_ID} {
  position:fixed; z-index:100001; display:none; flex-direction:column; width:240px; max-height:min(70vh, 440px);
  overflow:hidden; background:var(--zen-surface, #1f1f25);
  color:var(--zen-text, #e5e5ea);
  border:1px solid var(--zen-border, #34343c);
  border-radius:var(--zen-radius, 10px); box-shadow:0 12px 32px rgba(0,0,0,.46);
  font-family:var(--p-font-family, system-ui, sans-serif); font-size:13px;
}
#${POPUP_ID}.zen-open { display:flex; }
#${POPUP_ID} .zen-theme-head { flex:0 0 auto; padding:8px; border-bottom:1px solid var(--zen-border, #34343c); }
#${POPUP_ID} .zen-theme-foot { flex:0 0 auto; padding:8px; border-top:1px solid var(--zen-border, #34343c); }
#${POPUP_ID} .zen-theme-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; margin:0; padding:5px; list-style:none; }
#${POPUP_ID} .zen-seg { display:flex; border:1px solid var(--zen-border, #34343c); border-radius:var(--zen-radius, 8px); overflow:hidden; }
#${POPUP_ID} .zen-seg button { flex:1; background:none; border:none; padding:6px 0; font:inherit; font-size:12px; color:var(--zen-muted, #9aa0aa); cursor:pointer; }
#${POPUP_ID} .zen-seg button.on { background:var(--zen-accent, #3b82f6); color:var(--zen-accent-text, #fff); }
#${POPUP_ID} .zen-seg button:disabled { opacity:.4; cursor:default; }
#${POPUP_ID} .zen-theme-opt { display:flex; align-items:center; gap:9px; padding:6px 9px; cursor:pointer; color:inherit; text-decoration:none; border-radius:var(--zen-radius, 7px); }
#${POPUP_ID} .zen-theme-opt:hover { background:color-mix(in srgb, var(--zen-text, #fff) 12%, transparent); }
#${POPUP_ID} .zen-theme-opt.active { font-weight:600; background:color-mix(in srgb, var(--zen-accent, #3b82f6) 14%, transparent); }
#${POPUP_ID} .zen-dot { width:12px; height:12px; flex:0 0 auto; box-shadow: inset 0 0 0 1px rgba(255,255,255,.2); }
#${POPUP_ID} .zen-opt-label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#${POPUP_ID} .zen-check { flex:0 0 auto; font-size:12px; color:var(--zen-accent, #3b82f6); }
`

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = STYLE
  document.head.appendChild(el)
}

function modeSegment(mode: ThemeMode, modes: ThemeMode[]): HTMLDivElement {
  const seg = document.createElement('div')
  seg.className = 'zen-seg'
  for (const m of ['light', 'dark'] as ThemeMode[]) {
    const b = document.createElement('button')
    b.textContent = m === 'light' ? 'Light' : 'Dark'
    if (mode === m) b.classList.add('on')
    if (!modes.includes(m)) b.disabled = true
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      theme.setMode(m)
    })
    seg.appendChild(b)
  }
  return seg
}
function themeOption(id: string, active: boolean, labelOverride?: string): HTMLLIElement {
  const li = document.createElement('li')
  li.setAttribute('role', 'none')
  const a = document.createElement('a')
  a.className = 'zen-theme-opt' + (active ? ' active' : '')
  a.setAttribute('role', 'menuitemradio')
  const label = labelOverride ?? theme.packLabel(id)
  // The swatch previews both the theme's color and its corner rounding (--radius).
  const dot = `<span class="zen-dot" style="background:${theme.packSwatch(id)};border-radius:${theme.packRadius(id)}"></span>`
  const check = active ? '<i class="zen-check pi pi-check"></i>' : ''
  a.innerHTML = `${dot}<span class="zen-opt-label">${label}</span>${check}`
  a.addEventListener('click', (e) => {
    e.stopPropagation()
    theme.setPack(id)
  })
  li.appendChild(a)
  return li
}

// A ComfyUI ("1.0") palette row. We don't have each palette's colors, so the dot is neutral.
// Selecting it resets ZenKit to default and loads the palette through ComfyUI (applyComfyPalette).
function comfyOption(id: string, name: string, active: boolean): HTMLLIElement {
  const li = document.createElement('li')
  li.setAttribute('role', 'none')
  const a = document.createElement('a')
  a.className = 'zen-theme-opt' + (active ? ' active' : '')
  a.setAttribute('role', 'menuitemradio')
  const dot =
    '<span class="zen-dot" style="background:var(--zen-accent,#3b82f6);border-radius:50%"></span>'
  const check = active ? '<i class="zen-check pi pi-check"></i>' : ''
  a.innerHTML = `${dot}<span class="zen-opt-label">${name}</span>${check}`
  a.addEventListener('click', (e) => {
    e.stopPropagation()
    applyComfyPalette(id)
  })
  li.appendChild(a)
  return li
}

/** Controller for the ZenKit theme popup wired to the native ComfyUI menu item. */
export function createComfyThemeMenu() {
  let running = false
  let obs: MutationObserver | null = null
  let raf = 0
  let offTheme: (() => void) | null = null
  let popup: HTMLElement | null = null
  let head: HTMLElement | null = null
  let list: HTMLElement | null = null
  let foot: HTMLElement | null = null
  let anchor: HTMLElement | null = null // the native item the popup is currently shown for
  let closeTimer = 0
  // Which source the popup is showing. Default to the one matching the active theme.
  let sourceTab: 'comfy' | 'zenkit' = theme.current() === 'comfy' ? 'comfy' : 'zenkit'

  // [ Comfy │ ZenKit ] — switches which list (and whether the Light/Dark footer) shows.
  function sourceSegment(): HTMLDivElement {
    const seg = document.createElement('div')
    seg.className = 'zen-seg zen-seg-src'
    for (const t of ['comfy', 'zenkit'] as const) {
      const b = document.createElement('button')
      b.textContent = t === 'comfy' ? 'Comfy' : 'ZenKit'
      if (sourceTab === t) b.classList.add('on')
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        if (sourceTab === t) return
        sourceTab = t
        renderPopup()
        if (anchor) positionPopup(anchor) // height changes between tabs — re-anchor
      })
      seg.appendChild(b)
    }
    return seg
  }

  function renderPopup() {
    if (!head || !list || !foot) return
    const cur = theme.current()
    head.replaceChildren(sourceSegment())

    list.replaceChildren()
    if (sourceTab === 'zenkit') {
      for (const id of theme.packs()) {
        if (id === 'comfy') continue
        list.appendChild(themeOption(id, id === cur))
      }
    } else {
      const active = cur === 'comfy' ? getComfyPalette() : undefined
      for (const p of listComfyPalettes())
        list.appendChild(comfyOption(p.id, p.name, p.id === active))
    }

    // Light/Dark lives in a pinned footer — and only for ZenKit themes (ComfyUI palettes have
    // no separate light/dark axis). Hidden entirely on the Comfy tab.
    foot.replaceChildren()
    if (sourceTab === 'zenkit') {
      foot.appendChild(modeSegment(theme.currentMode(), theme.packModes(cur)))
      foot.style.display = ''
    } else {
      foot.style.display = 'none'
    }
  }

  function ensurePopup(): HTMLElement {
    if (popup) return popup
    popup = document.createElement('div')
    popup.id = POPUP_ID
    head = document.createElement('div')
    head.className = 'zen-theme-head' // pinned — never scrolls
    list = document.createElement('ul')
    list.className = 'zen-theme-scroll zen-scroll' // contained, themed scrollbar
    list.setAttribute('role', 'menu')
    foot = document.createElement('div')
    foot.className = 'zen-theme-foot' // pinned bottom — the Light/Dark switch (ZenKit tab only)
    popup.append(head, list, foot)
    document.body.appendChild(popup)
    // Hover-intent: staying on the popup keeps it open; leaving it closes (after the grace).
    popup.addEventListener('mouseenter', cancelClose)
    popup.addEventListener('mouseleave', scheduleClose)
    renderPopup()
    return popup
  }

  function positionPopup(item: HTMLElement) {
    const p = ensurePopup()
    const r = item.getBoundingClientRect()
    p.style.visibility = 'hidden'
    p.classList.add('zen-open')
    const pw = p.offsetWidth || 240
    const ph = p.offsetHeight || 320
    // Prefer opening to the right of the item; flip left if it would overflow.
    let left = r.right + 4
    if (left + pw > window.innerWidth - 6) left = Math.max(6, r.left - pw - 4)
    let top = r.top - 4
    if (top + ph > window.innerHeight - 6) top = Math.max(6, window.innerHeight - 6 - ph)
    p.style.left = `${left}px`
    p.style.top = `${top}px`
    p.style.visibility = ''
  }

  function openFor(item: HTMLElement) {
    cancelClose()
    anchor = item
    renderPopup() // reflect the latest active theme/mode
    positionPopup(item)
  }
  function closePopup() {
    cancelClose()
    popup?.classList.remove('zen-open')
    anchor = null
  }
  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = 0
    }
  }
  function scheduleClose() {
    cancelClose()
    closeTimer = window.setTimeout(closePopup, CLOSE_DELAY)
  }

  // Close when clicking away (e.g. the ComfyUI menu closes) — but not when interacting with us.
  function onPointerDown(e: PointerEvent) {
    const t = e.target as Node
    if (popup?.contains(t) || anchor?.contains(t)) return
    closePopup()
  }

  function wire(li: HTMLElement) {
    if (li.hasAttribute(WIRED)) return
    li.setAttribute(WIRED, '1')
    li.addEventListener('mouseenter', () => openFor(li))
    li.addEventListener('mouseleave', scheduleClose)
  }

  // We take theming over entirely, so ComfyUI's native "Theme" item is always hidden — its
  // palettes live in our popup's "1.0" tab instead.
  function applyComfyVisibility() {
    for (const li of document.querySelectorAll<HTMLElement>(`${MENU_SEL} [${COMFY_MARK}]`)) {
      li.style.display = 'none'
    }
  }

  function scan() {
    if (!running) return
    for (const menu of document.querySelectorAll<HTMLElement>(MENU_SEL)) {
      for (const li of menu.querySelectorAll<HTMLElement>('li')) {
        const label = li.querySelector('.p-menubar-item-label')?.textContent?.trim()
        if (label === ITEM_LABEL) wire(li)
        else if (label && /^theme$/i.test(label) && !li.hasAttribute(COMFY_MARK))
          li.setAttribute(COMFY_MARK, '1')
      }
    }
    applyComfyVisibility()
    // The anchor was removed (menu closed/rebuilt) → drop the popup.
    if (anchor && !anchor.isConnected) closePopup()
  }

  function schedule() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      scan()
    })
  }

  return {
    start() {
      if (running || typeof document === 'undefined') return
      running = true
      ensureStyle()
      obs = new MutationObserver(schedule)
      obs.observe(document.body, { childList: true, subtree: true })
      offTheme = theme.onChange(() => {
        applyComfyVisibility()
        if (anchor) renderPopup() // live-update the open popup
      })
      window.addEventListener('pointerdown', onPointerDown, true)
      scan()
    },
    stop() {
      running = false
      obs?.disconnect()
      obs = null
      offTheme?.()
      offTheme = null
      window.removeEventListener('pointerdown', onPointerDown, true)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      closePopup()
      popup?.remove()
      popup = head = list = foot = null
      // Restore ComfyUI's native "Theme" item we may have hidden.
      for (const li of document.querySelectorAll<HTMLElement>(`${MENU_SEL} [${COMFY_MARK}]`)) {
        li.style.display = ''
        li.removeAttribute(COMFY_MARK)
      }
    },
  }
}
