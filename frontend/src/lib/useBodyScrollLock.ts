import { useEffect } from "react";

/**
 * Locks body scroll when `locked` is true.
 * Compensates for scrollbar width to prevent layout shift.
 * Safe with multiple simultaneous callers — tracks a reference count.
 */
let lockCount = 0;
let savedScrollY = 0;
let savedOverflow = "";
let savedPaddingRight = "";

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      // Measure scrollbar width before hiding it
      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;

      savedScrollY = window.scrollY;
      savedOverflow = document.body.style.overflow;
      savedPaddingRight = document.body.style.paddingRight;

      document.body.style.overflow = "hidden";
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    lockCount++;

    return () => {
      lockCount--;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
        document.body.style.paddingRight = savedPaddingRight;
      }
    };
  }, [locked]);
}

/**
 * Imperative version — call lock()/unlock() directly.
 */
export const bodyScrollLock = {
  lock() {
    if (lockCount === 0) {
      const scrollbarWidth =
        window.innerWidth - document.documentElement.clientWidth;
      savedScrollY = window.scrollY;
      savedOverflow = document.body.style.overflow;
      savedPaddingRight = document.body.style.paddingRight;
      document.body.style.overflow = "hidden";
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    lockCount++;
  },
  unlock() {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow;
      document.body.style.paddingRight = savedPaddingRight;
    }
  },
};
