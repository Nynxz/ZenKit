/** The page LoRA Manager opens on. */
export const LM_HOME = '/loras'

// Every top-level page the LoRA Manager site serves (see py/routes/*: the model pages are
// registered as `/{prefix}`, recipes live under `/loras/recipes`, statistics is its own
// route). Used to validate a persisted path before it is handed back to the iframe.
const LM_ROUTES = ['/loras', '/checkpoints', '/embeddings', '/statistics']

/** True for a same-origin path that belongs to the LoRA Manager site.
 *
 *  Panel state is persisted by ZenKit and comes back from storage, so it is not trusted:
 *  this is what stops a corrupted or hand-edited state blob from pointing the panel's
 *  iframe at an arbitrary URL. Rejecting anything that isn't a bare absolute path also
 *  rules out "//evil.com" and "https://evil.com" forms. */
export function isLoraManagerPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!path.startsWith('/') || path.startsWith('//')) return false

  const pathname = path.split(/[?#]/)[0]
  return LM_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}
