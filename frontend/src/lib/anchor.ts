/**
 * Positioning helpers for popovers anchored to a trigger element.
 *
 * The UI runs under `zoom: var(--ui-scale)` on <html> (see index.css). Zoom
 * scales everything inside it, and — unlike a transform — that includes
 * descendants positioned with `position: fixed`. But getBoundingClientRect()
 * reports *visual* pixels, already multiplied by the zoom. Feeding a rect
 * straight back into `top`/`left` therefore makes the browser apply the zoom a
 * second time, and the element lands at `offset x zoom` instead of `offset`.
 *
 * The drift is proportional to the distance from the viewport origin, so a
 * menu near the top-left looks almost right while one lower down the page is
 * visibly detached: at 1.15, a trigger 872px down opened its menu 131px too
 * low and 150px too far right.
 *
 * Dividing by the zoom converts visual pixels back into the layout pixels that
 * `top`/`left`/`right` are actually measured in.
 */

/** Effective zoom on the document element, or 1 where none applies. */
export function uiZoom(): number {
  if (typeof document === "undefined") return 1;
  // Browsers without CSS zoom report "" or "normal"; parseFloat gives NaN and
  // we fall back to 1, leaving the arithmetic below a no-op.
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || "1");
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  /** Viewport size in the same units, for clamping a menu on screen. */
  viewportW: number;
  viewportH: number;
}

/**
 * The trigger's rect and the viewport, both converted to layout pixels.
 *
 * Use these instead of getBoundingClientRect() and window.innerWidth/Height
 * when the result feeds the inline `top`/`left`/`right` of a fixed-position
 * popover. Mixing the two spaces is its own bug: window.innerWidth is not
 * scaled by zoom while a rect is, so `innerWidth - rect.right` lands off by
 * the zoom factor even when both look reasonable.
 */
export function anchorRect(el: Element): AnchorRect {
  const z = uiZoom();
  const r = el.getBoundingClientRect();
  return {
    top: r.top / z,
    bottom: r.bottom / z,
    left: r.left / z,
    right: r.right / z,
    width: r.width / z,
    height: r.height / z,
    viewportW: window.innerWidth / z,
    viewportH: window.innerHeight / z,
  };
}
