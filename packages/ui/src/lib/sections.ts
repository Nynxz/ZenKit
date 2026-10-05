// The contract between ZenSections and the ZenSection children it groups. A section with a
// `value` inside a group asks the group whether it's open instead of using its own v-model:open,
// which is how an accordion closes the others without the sections knowing about each other.
import type { InjectionKey } from 'vue'

export interface SectionsContext {
  isOpen(value: string): boolean
  setOpen(value: string, open: boolean): void
  /** Called once from a child's setup. Seeds the group's state from the child's own `open` when
   *  the host didn't bind a v-model, so an unbound group still starts the way the markup says. */
  register(value: string, open: boolean): void
}

export const SECTIONS_KEY: InjectionKey<SectionsContext> = Symbol('zen-sections')
