// LoRA Manager adds a top-bar button that opens its site in a browser tab. With the panel in
// ZenKit's Start menu that button can be redundant, so this hides it on request. It is styled
// away rather than removed: LoRA Manager re-applies its icon whenever Vue re-renders the
// button, and a stylesheet keeps applying through that. Both selectors are LoRA Manager's own
// (web/comfyui/top_menu_extension.js): the action-bar button's label, and the button group
// used by ComfyUI frontends older than 1.33.9.
const HIDE_CSS = `
button[aria-label="Launch LoRA Manager (Shift+Click opens in new window)"],
.lora-manager-top-menu-group { display: none !important; }`

const STYLE_ID = 'zenintegrations-lm-hide-top-bar-button'

export const HIDE_TOP_BAR_BUTTON = {
  id: 'zenintegrations.loramanager.hideTopBarButton',
  name: 'Hide the top bar button',
  // The third element is a unique key, not a label (see ComfyUI-ZenKit/src/appearanceSettings.ts).
  category: ['Zen Integrations', 'LoRA Manager', 'Hide top bar button'],
  type: 'boolean',
  defaultValue: false,
  tooltip:
    "Hide LoRA Manager's top-bar button, which opens it in a browser tab. Its ZenKit panel " +
    'stays in the Start menu.',
  onChange(hide: boolean) {
    document.getElementById(STYLE_ID)?.remove()
    if (!hide) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = HIDE_CSS
    document.head.appendChild(style)
  },
}
