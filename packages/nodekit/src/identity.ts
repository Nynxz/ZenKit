// Pack identity, derived from one manifest so node ids, io types, routes and settings keys
// cannot disagree. A factory, not constants: nodekit is shared and cannot import a pack's
// manifest itself.

export interface PackManifest {
  /** Node-id prefix and extension name, e.g. "ncnt" -> "ncnt.MyNode". Dotted namespaces nest. */
  namespace: string
  /** Human-readable pack name — console warnings, and anywhere the pack names itself. */
  displayName: string
  /** Root ComfyUI menu category. */
  category: string
}

export interface Identity {
  NAMESPACE: string
  DISPLAY_NAME: string
  CATEGORY: string
  ROUTE_PREFIX: string
  /** Fully-qualified node_id / comfyClass — what a NodeDef's `is` must match. */
  nodeId(name: string): string
  /** Namespaced custom io type — the key ComfyUI matches a widget on.
   *
   *  Accepts either spelling and produces the same result, so a component name and a
   *  hand-written type agree: `typeId('LoraStack')` and `typeId('LORA_STACK')` are both
   *  `NYNXZ_LORA_STACK`. That is what lets `discoverWidgets` derive the type from a
   *  filename while a python schema can spell it out. */
  typeId(name: string): string
  /** Namespaced HTTP route, matching the Python side's `route()`. */
  route(path: string): string
  /** Namespaced ComfyUI settings key. */
  settingId(name: string): string
}

export function makeIdentity(pack: PackManifest): Identity {
  const NAMESPACE = pack.namespace
  // "acme.labs" -> "/acme/labs"
  const ROUTE_PREFIX = '/' + NAMESPACE.split('.').join('/')
  // "acme.labs" -> "ACME_LABS_"
  const ioPrefix = NAMESPACE.toUpperCase().replace(/[.-]/g, '_') + '_'

  return {
    NAMESPACE,
    DISPLAY_NAME: pack.displayName,
    CATEGORY: pack.category,
    ROUTE_PREFIX,
    nodeId: (name) => `${NAMESPACE}.${name}`,
    // PascalCase -> SCREAMING_SNAKE; idempotent on names already in that form.
    typeId: (name) =>
      ioPrefix +
      name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toUpperCase(),
    route: (path) => `${ROUTE_PREFIX}/${path.replace(/^\/+/, '')}`,
    settingId: (name) => `${NAMESPACE}.${name}`,
  }
}
