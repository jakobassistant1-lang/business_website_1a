import type { Config } from "tailwindcss";

// Flowboard design tokens are defined as CSS variables in app/globals.css
// (RGB channel triplets, e.g. `--accent: 124 92 240`). Wrapping them in
// `rgb(var(--x) / <alpha-value>)` keeps Tailwind's opacity modifiers working
// (e.g. `bg-accent-soft/40`) AND makes every utility theme-aware: flip the
// `[data-theme]` attribute and the whole palette swaps. One token system, no
// per-component `dark:` variants.
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: v("--bg"),
        surface: {
          DEFAULT: v("--surface"),
          soft: v("--surface-soft"),
        },
        // Charcoal panel — the two-tone anchor. Stays dark in both themes.
        sidebar: v("--sidebar"),
        ink: v("--ink"),
        muted: v("--muted"),
        faint: v("--faint"),
        line: {
          DEFAULT: v("--line"),
          subtle: v("--line-subtle"),
        },
        accent: {
          DEFAULT: v("--accent"),
          hover: v("--accent-hover"),
          soft: v("--accent-soft"),
          ring: v("--accent-ring"),
          on: v("--on-accent"),
        },
        success: { DEFAULT: v("--success"), soft: v("--success-soft") },
        warning: { DEFAULT: v("--warning"), soft: v("--warning-soft") },
        danger: { DEFAULT: v("--danger"), soft: v("--danger-soft") },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      borderRadius: {
        // Generous radii per the Flowboard reference (8 / 12 / 14 / 18 / 26px).
        sm: "8px",
        DEFAULT: "10px",
        md: "12px",
        lg: "14px",
        xl: "18px",
        "2xl": "26px",
      },
    },
  },
  plugins: [],
};

export default config;
