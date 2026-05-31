import { type ReactNode } from "react";
import clsx from "clsx";

// ── Illustration assets ─────────────────────────────────────────────────────

function IllustrationClipboard() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Shadow / base */}
      <ellipse cx="36" cy="64" rx="20" ry="4" fill="rgba(90,82,229,0.08)" />

      {/* Clipboard body */}
      <rect x="12" y="14" width="48" height="52" rx="8" fill="url(#cbGrad)" />
      <rect x="12" y="14" width="48" height="52" rx="8" stroke="url(#cbStroke)" strokeWidth="1.2" />

      {/* Clip */}
      <rect x="26" y="10" width="20" height="12" rx="6" fill="url(#clipGrad)" />
      <rect x="26" y="10" width="20" height="12" rx="6" stroke="rgba(90,82,229,0.3)" strokeWidth="1" />
      <circle cx="36" cy="16" r="3" fill="white" fillOpacity="0.7" />

      {/* Lines representing content */}
      <rect x="20" y="32" width="32" height="3" rx="1.5" fill="rgba(90,82,229,0.15)" />
      <rect x="20" y="40" width="24" height="3" rx="1.5" fill="rgba(90,82,229,0.10)" />
      <rect x="20" y="48" width="28" height="3" rx="1.5" fill="rgba(90,82,229,0.10)" />

      {/* + icon overlay */}
      <circle cx="52" cy="54" r="9" fill="url(#plusGrad)" />
      <circle cx="52" cy="54" r="9" stroke="white" strokeWidth="2" />
      <path d="M52 50v8M48 54h8" stroke="white" strokeWidth="2" strokeLinecap="round" />

      {/* Gradients */}
      <defs>
        <linearGradient id="cbGrad" x1="12" y1="14" x2="60" y2="66" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F8FAFF" />
          <stop offset="1" stopColor="#EEF2FF" />
        </linearGradient>
        <linearGradient id="cbStroke" x1="12" y1="14" x2="60" y2="66" gradientUnits="userSpaceOnUse">
          <stop stopColor="rgba(90,82,229,0.20)" />
          <stop offset="1" stopColor="rgba(90,82,229,0.08)" />
        </linearGradient>
        <linearGradient id="clipGrad" x1="26" y1="10" x2="46" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818CF8" />
          <stop offset="1" stopColor="#5A52E5" />
        </linearGradient>
        <linearGradient id="plusGrad" x1="43" y1="45" x2="61" y2="63" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5A52E5" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function IllustrationFolderEmpty() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <ellipse cx="36" cy="64" rx="22" ry="4" fill="rgba(90,82,229,0.07)" />
      <rect x="8" y="22" width="56" height="38" rx="8" fill="url(#fGrad)" stroke="rgba(90,82,229,0.15)" strokeWidth="1.2" />
      <path d="M8 30h56" stroke="rgba(90,82,229,0.10)" strokeWidth="1.2" />
      <path d="M8 22 C8 18 10 16 14 16 L28 16 L32 22" fill="url(#fTab)" />
      <path d="M8 22 C8 18 10 16 14 16 L28 16 L32 22" stroke="rgba(90,82,229,0.15)" strokeWidth="1.2" />
      {/* Dotted outline in center */}
      <rect x="24" y="34" width="24" height="18" rx="4"
        stroke="rgba(90,82,229,0.18)" strokeWidth="1.5" strokeDasharray="3 3" fill="none" />
      <defs>
        <linearGradient id="fGrad" x1="8" y1="22" x2="64" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5F7FF" />
          <stop offset="1" stopColor="#EEF2FF" />
        </linearGradient>
        <linearGradient id="fTab" x1="8" y1="16" x2="32" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C7D2FE" />
          <stop offset="1" stopColor="#A5B4FC" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const ILLUSTRATIONS = {
  clipboard: IllustrationClipboard,
  folder:    IllustrationFolderEmpty,
} as const;

type IllustrationKey = keyof typeof ILLUSTRATIONS;

// ── EmptyState component ────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  action,
  illustration = "clipboard",
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  illustration?: IllustrationKey;
  className?: string;
}) {
  const Illustration = ILLUSTRATIONS[illustration];

  return (
    <div className={clsx(
      "flex flex-col items-center justify-center py-16 px-6 text-center select-none",
      className
    )}>
      {/* Illustration with soft glow ring */}
      <div className="relative mb-5">
        <div
          className="absolute inset-0 rounded-full blur-2xl"
          style={{ background: "radial-gradient(circle, rgba(90,82,229,0.12) 0%, transparent 70%)" }}
        />
        <Illustration />
      </div>

      {/* Text */}
      <h3 className="text-[15px] font-semibold text-slate-800 dark:text-slate-200 leading-snug">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 text-[13px] text-slate-500 dark:text-slate-400 max-w-[260px] leading-relaxed">
          {description}
        </p>
      )}

      {/* Action */}
      {action && (
        <div className="mt-5">{action}</div>
      )}
    </div>
  );
}
