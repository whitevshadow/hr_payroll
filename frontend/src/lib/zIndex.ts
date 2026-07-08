/**
 * Centralized z-index ladder — every overlay layer has exactly one entry here.
 * No component should hardcode a z-index value; import from this module instead.
 *
 *   Tooltip     1_000   — ephemeral text labels
 *   Dropdown    1_100   — menus, selects, context menus
 *   Popover     1_200   — info panels, date pickers
 *   Modal       1_300   — dialog + backdrop
 *   Drawer      1_400   — slide-in panels
 *   Toast       1_500   — notifications (must sit above everything)
 *   Notification 1_500  — bell panel (same tier as toast)
 *   CmdPalette  1_600   — Ctrl+K overlay (global, above all)
 */
export const Z = {
  tooltip:      1_000,
  dropdown:     1_100,
  popover:      1_200,
  modalBackdrop:1_299,
  modal:        1_300,
  drawer:       1_400,
  toast:        1_500,
  notification: 1_500,
  cmdPalette:   1_600,
} as const;

export type ZLayer = typeof Z[keyof typeof Z];
