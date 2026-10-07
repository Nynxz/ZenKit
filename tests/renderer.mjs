import { createRenderer } from 'vue'

// Minimal DOM-shaped hosts for Vue component lifecycle tests, including Teleport.
export function testRenderer() {
  const element = (tag = 'root') => ({
    tag,
    props: {},
    style: {},
    listeners: new Map(),
    capture: null,
    addEventListener(type, callback) {
      this.listeners.set(type, callback)
    },
    removeEventListener(type, callback) {
      if (this.listeners.get(type) === callback) this.listeners.delete(type)
    },
    setPointerCapture(id) {
      this.capture = id
    },
    hasPointerCapture(id) {
      return this.capture === id
    },
    releasePointerCapture() {
      this.capture = null
    },
    offsetWidth: 200,
    offsetHeight: 200,
    getBoundingClientRect: () => ({ width: 200, height: 200 }),
    children: [],
    querySelector: () => null,
    replaceChildren() {
      this.children = []
    },
  })
  const body = element('body')
  const remove = (child) => {
    if (child.parent)
      child.parent.children = child.parent.children.filter((entry) => entry !== child)
    child.parent = null
  }
  const renderer = createRenderer({
    createElement: element,
    createText: () => element('text'),
    createComment: () => element('comment'),
    insert: (child, parent, anchor) => {
      remove(child)
      const at = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(at < 0 ? parent.children.length : at, 0, child)
      child.parent = parent
    },
    remove,
    patchProp: (el, key, _old, value) => {
      el.props[key] = value
    },
    setText() {},
    setElementText() {},
    parentNode: (child) => child.parent,
    nextSibling: (child) =>
      child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
    querySelector: () => body,
  })
  return { renderer, element, body }
}

export function findElement(root, tag) {
  if (root.tag === tag) return root
  for (const child of root.children ?? []) {
    const found = findElement(child, tag)
    if (found) return found
  }
  return null
}
