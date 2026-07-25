/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // "Systematic Trust" design system — Inter throughout
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        display: [
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
        // Primary — "Systematic Trust" Razorpay Blue #3395FF
        accent: {
          DEFAULT: "#3395FF",
          50:  "#EAF3FF",
          100: "#D6E9FF",
          200: "#ADD3FF",
          300: "#85BDFF",
          400: "#5CA7FF",
          500: "#3395FF",
          600: "#1A7FEA",
          700: "#005FAF",
          800: "#004785",
          900: "#002D58",
        },
        // Secondary — deep navy #0D233E (sidebar / high-level navigation)
        secondary: {
          DEFAULT: "#0D233E",
          50:  "#EAEDF2",
          100: "#D2D9E3",
          300: "#7C8CA3",
          500: "#33475F",
          700: "#17304C",
          900: "#0D233E",
        },
        // Tertiary — brand orange #E07800
        tertiary: {
          DEFAULT: "#E07800",
          50:  "#FFF3E5",
          100: "#FFDCC4",
          300: "#FFB77F",
          500: "#E07800",
          700: "#924C00",
          900: "#482200",
        },
        // Semantic
        success: { DEFAULT: "#10B981", light: "#D1FAE5", dark: "#059669" },
        warning: { DEFAULT: "#F59E0B", light: "#FEF3C7", dark: "#D97706" },
        danger:  { DEFAULT: "#EF4444", light: "#FEE2E2", dark: "#DC2626" },
        info:    { DEFAULT: "#0EA5E9", light: "#E0F2FE", dark: "#0284C7" },
        // Neutral surface
        surface: {
          DEFAULT: "#F8FAFC",
          card:    "#FFFFFF",
          border:  "#E2E8F0",
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
