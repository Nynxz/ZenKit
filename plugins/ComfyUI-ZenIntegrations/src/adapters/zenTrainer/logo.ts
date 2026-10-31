// ZenTrainer's lotus, inlined: a standalone ZenTrainer is another origin, and the sidebar rail
// draws image icons as a CSS mask, which another origin only serves with CORS headers. Inline,
// nothing is fetched (no CORS, no Chrome Local Network Access block on a LAN-to-loopback hop).

const PETAL = 'M0,0 C24,-16.2 16.8,-42.12 0,-54 C-16.8,-42.12 -24,-16.2 0,0Z'
const MID = 'M0,0 C26,-19.8 18.2,-51.48 0,-66 C-18.2,-51.48 -26,-19.8 0,0Z'
const TOP = 'M0,0 C28,-23.4 19.6,-60.84 0,-78 C-19.6,-60.84 -28,-23.4 0,0Z'

const lotus = (fill: string, transform: string) =>
  `<g transform="${transform}" fill="${fill}">` +
  `<path d="${PETAL}" transform="rotate(-70)" opacity="0.35"/>` +
  `<path d="${PETAL}" transform="rotate(70)" opacity="0.35"/>` +
  `<path d="${MID}" transform="rotate(-36)" opacity="0.6"/>` +
  `<path d="${MID}" transform="rotate(36)" opacity="0.6"/>` +
  `<path d="${TOP}"/></g>`

const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`

/** The app's favicon: a white lotus on its violet tile, for the plugin popover. */
export const ZT_LOGO = dataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="12.8" fill="#7c3aed"/>' +
    lotus('#ffffff', 'translate(32 47) scale(0.4)') +
    '</svg>',
)

/** The lotus alone, so the rail's mask draws its shape (a tile would mask to a plain square),
 *  and a panel's title bar shows it in the brand violet. */
export const ZT_ICON = dataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    lotus('#8b5cf6', 'translate(32 52) scale(0.55)') +
    '</svg>',
)
