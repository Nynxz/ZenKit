// The semantic design tokens a pack may set. Components style off these via
// var(--token); a pack overrides them at the root. Packs may set fewer than
// these — base.ts guarantees every one has a value.
export const THEME_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius',
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]
