import type { Config } from "tailwindcss";

// Maps the EDGE Design System CSS variables (src/theme/tokens.css, ported
// from coaching-ops/scheduling-app's Styles.html) into Tailwind utilities,
// so components use `bg-surface`, `text-edge-teal`, `rounded-edge-md`, etc.
// instead of ad hoc inline styles or re-declaring the palette.
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        edge: {
          teal: "var(--edge-teal)",
          "teal-dark": "var(--edge-teal-dark)",
          navy: "var(--edge-navy)",
        },
        bg: "var(--c-bg)",
        surface: "var(--c-surface)",
        surface2: "var(--c-surface2)",
        surface3: "var(--c-surface3)",
        border: "var(--c-border)",
        "border-hover": "var(--c-border-hover)",
        accent: "var(--c-accent)",
        "accent-soft": "var(--c-accent-soft)",
        info: "var(--c-blue)",
        "info-soft": "var(--c-blue-soft)",
        success: "var(--c-green)",
        "success-soft": "var(--c-green-soft)",
        warning: "var(--c-yellow)",
        "warning-soft": "var(--c-yellow-soft)",
        danger: "var(--c-red)",
        text: "var(--c-text)",
        "text-muted": "var(--c-text-muted)",
        "text-dim": "var(--c-text-dim)",
        "nav-active": "var(--c-nav-active)",
      },
      borderRadius: {
        "edge-sm": "var(--radius-sm)",
        "edge-md": "var(--radius-md)",
        "edge-lg": "var(--radius-lg)",
        "edge-xl": "var(--radius-xl)",
      },
      boxShadow: {
        "edge-sm": "var(--shadow-sm)",
        "edge-md": "var(--shadow-md)",
        "edge-lg": "var(--shadow-lg)",
        "edge-glow": "var(--shadow-glow)",
      },
      fontFamily: {
        ui: ["Poppins", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      keyframes: {
        // Used behind Tailwind's built-in motion-safe: variant (which maps
        // to prefers-reduced-motion automatically), never applied directly
        // -- see SuccessBanner.tsx for the one place this ships today.
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.94) translateY(-2px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
      },
      animation: {
        "pop-in": "pop-in 220ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
