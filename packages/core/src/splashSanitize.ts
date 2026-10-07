// Cleaning a theme pack's own splash before it reaches ComfyUI's boot script, which puts
// `comfy-splash-sequence`'s html into `innerHTML` and its css into a <style> on every load,
// before any extension runs. Theme packs are trusted, code-like content (see Themes.md), but a
// downloaded one must still not get script into that boot path, nor make it fetch remote URLs.
//
// The html is parsed inert (a <template>), then rebuilt from an allow-list of basic HTML and SVG
// shapes: no script, no on* attributes, no iframe/object/embed/form/img, no SMIL animation (it
// can rewrite an href), no raw-text elements (style, title, textarea, … are where mutation XSS
// lives), and no URL other than a `#fragment` (an SVG gradient or `<use>`). The css goes through the
// browser's own parser (a constructable stylesheet, which ignores @import), and every url() /
// image-set() that isn't same-origin or a `#fragment` is dropped.

const HTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'

const ELEMENTS: Record<string, Set<string>> = {
  [HTML_NS]: new Set(
    'div span p br hr b i em strong small sub sup h1 h2 h3 h4 h5 h6 ul ol li figure figcaption'.split(
      ' ',
    ),
  ),
  [SVG_NS]: new Set(
    'svg g defs symbol use path circle ellipse rect line polyline polygon text tspan lineargradient radialgradient stop clippath mask pattern'.split(
      ' ',
    ),
  ),
}

const ATTRIBUTES = new Set(
  (
    'class id style title width height aria-hidden aria-label role href xlink:href ' +
    'viewbox preserveaspectratio xmlns d cx cy r rx ry x y x1 y1 x2 y2 dx dy points transform ' +
    'fill fill-opacity fill-rule clip-rule clip-path mask stroke stroke-width stroke-opacity ' +
    'stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit ' +
    'opacity offset stop-color stop-opacity gradientunits gradienttransform spreadmethod fx fy ' +
    'patternunits patterntransform pathlength text-anchor dominant-baseline font-size ' +
    'font-family font-weight letter-spacing'
  ).split(' '),
)

/** A same-origin path or a `#fragment`: no scheme, no `//host`, no backslash. */
function localUrl(value: string): boolean {
  const v = value.trim()
  if (!v || v.startsWith('#')) return true
  if (v.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(v)) return false
  try {
    return new URL(v, location.href).origin === location.origin
  } catch {
    return false
  }
}

// Every function that can fetch: url() is allowed when local, the others never.
const FETCHING_FN = /(?:url|image-set|image|src|element|cross-fade)\(/gi
const LOCAL_URL_FN = /^url\(\s*(["']?)([\w\-./#%?=&:]*)\1\s*\)/i

/** A declaration value is kept only if every url() in it is local and plain, and it has no
 *  escapes or comments that could hide one. */
function safeValue(value: string): boolean {
  if (value.includes('\\') || value.includes('/*')) return false
  for (const m of value.matchAll(FETCHING_FN)) {
    const arg = LOCAL_URL_FN.exec(value.slice(m.index))
    if (!arg || !localUrl(arg[2] ?? '')) return false
  }
  return true
}

// Shorthands that can carry a url(); dropped whole so their longhands don't linger as `initial`.
const URL_SHORTHANDS = ['background', 'mask', '-webkit-mask', 'border-image', 'list-style']

/** Drop the declarations of one style block that would fetch something remote. */
function cleanDeclarations(style: CSSStyleDeclaration): void {
  for (const prop of URL_SHORTHANDS) {
    if (!safeValue(style.getPropertyValue(prop))) style.removeProperty(prop)
  }
  for (const prop of Array.from(style)) {
    if (!safeValue(style.getPropertyValue(prop))) style.removeProperty(prop)
  }
}

function cleanRules(rules: CSSRuleList): void {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!
    const parent = rule.parentRule ?? rule.parentStyleSheet
    if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) {
      ;(parent as CSSStyleSheet | CSSGroupingRule).deleteRule(i)
      continue
    }
    const r = rule as CSSRule & { style?: CSSStyleDeclaration; cssRules?: CSSRuleList }
    if (r.style) cleanDeclarations(r.style)
    if (r.cssRules) cleanRules(r.cssRules)
  }
}

/** Splash css with @import and every non-local url() removed; '' when it can't be checked. */
export function sanitizeSplashCss(css: string): string {
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css) // @import rules are ignored by replaceSync
    cleanRules(sheet.cssRules)
    // Last check on the serialized rules, for anything a rule kind above doesn't expose.
    return Array.from(sheet.cssRules, (r) => r.cssText)
      .filter(safeValue)
      .join('\n')
  } catch {
    return ''
  }
}

/** A theme colour for the splash's background/foreground/accent (it lands in an inline style),
 *  or undefined when it could fetch something remote. */
export function sanitizeSplashColor(value: string | undefined): string | undefined {
  return value && safeValue(value) ? value : undefined
}

function cleanElement(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    const value = attr.value
    let keep = ATTRIBUTES.has(name) && !name.startsWith('on')
    if (keep && (name === 'href' || name === 'xlink:href')) keep = /^#[\w-]+$/.test(value.trim())
    else if (keep && name === 'style') {
      const style = (el as HTMLElement | SVGElement).style
      cleanDeclarations(style)
      // Always re-serialized, so what's stored is what the CSS parser understood.
      const css = style.cssText
      keep = css !== ''
      if (keep) el.setAttribute('style', css)
    } else if (keep && !safeValue(value)) keep = false
    if (!keep) el.removeAttribute(attr.name)
  }
}

function cleanChildren(parent: ParentNode): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove() // comments, CDATA, processing instructions
      continue
    }
    const el = node as Element
    const allowed = ELEMENTS[el.namespaceURI ?? '']?.has(el.localName.toLowerCase())
    if (!allowed) {
      el.remove()
      continue
    }
    cleanElement(el)
    cleanChildren(el)
  }
}

/** Splash markup reduced to the allow-listed HTML and SVG above; '' if nothing usable is left. */
export function sanitizeSplashHtml(html: string): string {
  try {
    const template = document.createElement('template')
    template.innerHTML = html // template content is inert: nothing loads, nothing runs
    cleanChildren(template.content)
    const out = template.innerHTML.trim()
    // Re-parsing must not change it, or the browser would build something we never checked.
    const again = document.createElement('template')
    again.innerHTML = out
    cleanChildren(again.content)
    return again.innerHTML.trim() === out ? out : ''
  } catch {
    return ''
  }
}
