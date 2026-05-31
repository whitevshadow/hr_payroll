/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // Primary — Plus Jakarta Sans
        sans: [
          "Plus Jakarta Sans",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        // Display / headings
        display: [
          "Plus Jakarta Sans",
          "Space Grotesk",
          "Inter",
          "ui-sans-serif",
          "sans-serif",
        ],
        // Monospace
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "Cascadia Code",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
      colors: {
        // Primary accent — Indigo #5A52E5
        accent: {
          DEFAULT: "#5A52E5",
          50:  "#EDEEFF",
          100: "#E0E1FF",
          200: "#C3C5FD",
          300: "#A5A8FB",
          400: "#8A8CF8",
          500: "#6E6FF4",
          600: "#5A52E5",
          700: "#4841CC",
          800: "#3830A6",
          900: "#2A2484",
        },
        // Semantic
        success: { DEFAULT: "#10B981", light: "#D1FAE5", dark: "#059669" },
        warning: { DEFAULT: "#F59E0B", light: "#FEF3C7", dark: "#D97706" },
        danger:  { DEFAULT: "#EF4444", light: "#FEE2E2", dark: "#DC2626" },
        info:    { DEFAULT: "#3B82F6", light: "#DBEAFE", dark: "#2563EB" },
        // Neutral surface
        surface: {
          DEFAULT: "#F8FAFF",
          card:    "rgba(255,255,255,0.55)",
          border:  "rgba(220,230,245,0.60)",
        },
      },
      backdropBlur: {
        xs: "2px",
        sm: "6px",
      },
      borderRadius: {
        pill: "9999px",
        "2xl": "20px",
        "3xl": "24px",
        "4xl": "32px",
      },
      boxShadow: {
        glass:    "var(--shadow-glass)",
        card:     "var(--shadow-card)",
        topbar:   "var(--shadow-topbar)",
        sidebar:  "var(--shadow-sidebar)",
        btn:      "var(--shadow-btn)",
        "inner-glow": "inset 0 1px 0 0 rgba(255,255,255,0.45)",
      },
      animation: {
        "fade-in":   "fadeIn 0.2s ease-out",
        "slide-up":  "slideUp 0.22s cubic-bezier(0.16,1,0.3,1)",
        "scale-in":  "scaleIn 0.18s cubic-bezier(0.16,1,0.3,1)",
        shimmer:     "shimmer 2s infinite linear",
        "pulse-soft":"pulseSoft 2s ease-in-out infinite",
        "orb-float": "orbFloat 40s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%":   { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          "0%":   { opacity: "0", transform: "translateX(-50%) scale(0.95)" },
          "100%": { opacity: "1", transform: "translateX(-50%) scale(1)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.65" },
        },
        orbFloat: {
          "0%, 100%": { transform: "translate3d(0,0,0)" },
          "33%":      { transform: "translate3d(18px,-22px,0)" },
          "66%":      { transform: "translate3d(-12px,14px,0)" },
        },
      },
      spacing: {
        "4.5": "1.125rem",
        "13":  "3.25rem",
        "15":  "3.75rem",
        "18":  "4.5rem",
      },
    },
  },
  plugins: [],
};
