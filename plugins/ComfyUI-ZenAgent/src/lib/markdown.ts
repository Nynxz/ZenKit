import DOMPurify from 'dompurify'
import { Marked } from 'marked'

// Model output is untrusted: a prompt-injected reply must not load anything, restyle the page or
// fake a form. So it renders as text formatting only. Images become plain links the user can
// choose to open, links open in a new tab without a referrer, and only http(s) and mailto links
// survive.

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
]
const SAFE_HREF = /^(https?:|mailto:)/i

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

/** An image as a link that loads nothing until clicked. */
const imageLink = (href: string, alt: string) =>
  `<a href="${escape(href)}">image: ${escape(alt || href)}</a>`

const marked = new Marked({
  async: false,
  breaks: true,
  renderer: {
    image: ({ href, text }) => imageLink(href, text),
  },
})

const purify = DOMPurify(window)
// Raw <img> in the reply: keep it visible as a link instead of dropping it silently.
purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'img' || !(node instanceof Element)) return
  const src = node.getAttribute('src') ?? ''
  const tpl = document.createElement('template')
  tpl.innerHTML = src ? imageLink(src, node.getAttribute('alt') ?? '') : ''
  node.replaceWith(tpl.content)
})
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return
  const href = node.getAttribute('href') ?? ''
  if (!SAFE_HREF.test(href.trim())) node.removeAttribute('href')
  node.setAttribute('rel', 'noopener noreferrer nofollow')
  node.setAttribute('target', '_blank')
})

const CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR: ['href'],
  ALLOWED_URI_REGEXP: SAFE_HREF,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  FORBID_TAGS: ['style', 'img', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select'],
  FORBID_ATTR: ['style', 'src', 'srcset', 'action', 'formaction', 'background', 'poster'],
  WHOLE_DOCUMENT: false,
}

/** Markdown from the model as sanitised HTML, safe for v-html. */
export function renderMarkdown(text: string): string {
  return purify.sanitize(marked.parse(text) as string, CONFIG)
}
