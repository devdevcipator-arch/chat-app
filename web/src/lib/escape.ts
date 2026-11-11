// Escape-key layering. Anything on screen that handles Escape itself (modals,
// overlays, menus, panels, the voice recorder...) matches ESCAPE_LAYERS, and
// lower-priority shortcuts (like "Esc leaves the chat") stand aside for it.
// Mark custom ones with the ESCAPE_LAYER attribute.

export const ESCAPE_LAYER = { "data-escape-layer": "" } as const;

const ESCAPE_LAYERS = 'dialog[open], [aria-modal="true"], [role="menu"], [data-escape-layer]';

/** True while something else on screen owns the Escape key. */
export const escapeIsTaken = () => typeof document !== "undefined" && !!document.querySelector(ESCAPE_LAYERS);
