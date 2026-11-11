// Escape-key layering. Anything on screen that handles Escape itself (modals,
// overlays, menus, panels, the voice recorder...) matches ESCAPE_LAYERS, and
// lower-priority shortcuts (like "Esc leaves the chat") stand aside for it.
// Mark custom ones with the ESCAPE_LAYER attribute.

export const ESCAPE_LAYER = { "data-escape-layer": "" } as const;

const ESCAPE_LAYERS = 'dialog[open], [aria-modal="true"], [role="menu"], [data-escape-layer]';

/**
 * True while something visible owns the Escape key. Visibility matters: with
 * Cache Components, pages you navigated away from stay in the DOM (hidden by
 * <Activity>), and their dialogs or recorder must not swallow Escape here.
 */
export function escapeIsTaken() {
  if (typeof document === "undefined") return false;
  return Array.from(document.querySelectorAll<HTMLElement>(ESCAPE_LAYERS)).some((el) =>
    typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0,
  );
}
