// Neutral dark defaults for every token. Applied beneath a pack so partial packs
// (which set only a few tokens) still render every component correctly. Inside
// ComfyUI the host bridge supplies these from the user's theme instead.
export const BASE_TOKENS: Record<string, string> = {
  '--background': '#18181b',
  '--foreground': '#e5e5ea',
  '--card': '#202026',
  '--card-foreground': '#e5e5ea',
  '--popover': '#202026',
  '--popover-foreground': '#e5e5ea',
  '--primary': '#3b82f6',
  '--primary-foreground': '#ffffff',
  '--secondary': '#27272e',
  '--secondary-foreground': '#e5e5ea',
  '--muted': '#27272e',
  '--muted-foreground': '#a1a1aa',
  '--accent': '#2e2e38',
  '--accent-foreground': '#e5e5ea',
  '--destructive': '#b91c1c',
  '--destructive-foreground': '#ffffff',
  '--border': '#3a3a44',
  '--input': '#3a3a44',
  '--ring': '#3b82f6',
  '--radius': '8px',
}
