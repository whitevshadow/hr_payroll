/**
 * Modal — Portal-based dialog that renders directly into #modal-root (outside
 * the React app tree) so it is never clipped by overflow:hidden ancestors,
 * backdrop-filter stacking contexts, or transform-creating Framer Motion wrappers.
 *
 * Features:
 *  • createPortal into #modal-root (falls back to document.body)
 *  • Body scroll lock (compensates scrollbar width to prevent layout shift)
 *  • Focus trap — Tab / Shift+Tab cycle inside modal
 *  • ESC closes
 *  • Click outside backdrop closes
 *  • ARIA: role="dialog", aria-modal, aria-labelledby
 *  • Framer Motion enter/exit animations
 *  • Scrollable body when content overflows (never overflows viewport)
 *  • Responsive sizes: sm / md / lg / xl / full
 */
import {
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import clsx from "clsx";
import { Z } from "../lib/zIndex";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPortalRoot(): HTMLElement {
  return document.getElementById("modal-root") ?? document.body;
}

const FOCUSABLE =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(container: HTMLElement, event: KeyboardEvent) {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!nodes.length) return;
  const first = nodes[0];
  const last  = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ─── Size map ─────────────────────────────────────────────────────────────────

const sizeClasses: Record<string, string> = {
  sm:   "max-w-sm",
  md:   "max-w-lg",
  lg:   "max-w-2xl",
  xl:   "max-w-4xl",
  full: "max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]",
};

// ─── Main Modal component ─────────────────────────────────────────────────────

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** Hide the built-in header (title + close button). */
  bare?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  bare = false,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId  = `modal-title-${title.replace(/\s+/g, "-").toLowerCase()}`;

  // Body scroll lock
  useBodyScrollLock(open);

  // ESC + focus trap
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        trapFocus(panelRef.current, e);
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [open, onClose]);

  // Move focus into modal on open
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const portal = createPortal(
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          // Centering wrapper — NOT `overflow-hidden` so inner scroll works
          className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 sm:p-6 sm:items-center"
          style={{ zIndex: Z.modal }}
          onClick={handleBackdropClick}
        >
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0"
            style={{ zIndex: Z.modalBackdrop }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            aria-hidden="true"
          >
            <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm" />
          </motion.div>

          {/* Panel */}
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={clsx(
              // Positioning — relative to centering wrapper, above backdrop
              "relative my-auto w-full",
              // Glass surface
              "glass-modal",
              // Max height: leave 2rem gap at top and bottom
              "max-h-[calc(100vh-3rem)] flex flex-col",
              sizeClasses[size],
            )}
            style={{ zIndex: Z.modal }}
            // Stop clicks inside panel from hitting backdrop handler
            onClick={(e) => e.stopPropagation()}
          >
            {!bare && (
              <div className="flex items-center justify-between border-b border-[var(--glass-border)] px-5 py-4 shrink-0">
                <h2
                  id={titleId}
                  className="font-display text-[15px] font-semibold text-[var(--text-primary)]"
                >
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-xl text-[var(--text-muted)] hover:bg-[var(--glass-card-bg)] hover:text-[var(--text-primary)] transition-colors"
                  aria-label="Close dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Scrollable body — never overflows the viewport */}
            <div className="overflow-y-auto flex-1 p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    getPortalRoot(),
  );

  return portal;
}

// ─── ModalFooter ──────────────────────────────────────────────────────────────

export function ModalFooter({
  onClose,
  onSave,
  saving,
  saveLabel = "Save",
  disabled,
}: {
  onClose: () => void;
  onSave?: () => void;
  saving?: boolean;
  saveLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--glass-border)] pt-4 sm:flex-row sm:justify-end">
      <button type="button" className="btn-ghost" onClick={onClose}>
        Cancel
      </button>
      {onSave && (
        <button
          type="button"
          className="btn"
          disabled={saving || disabled}
          onClick={onSave}
        >
          {saving ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Saving…
            </>
          ) : (
            saveLabel
          )}
        </button>
      )}
    </div>
  );
}
