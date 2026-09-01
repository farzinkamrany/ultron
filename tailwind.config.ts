import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        phase1: 'rgb(var(--color-phase1) / <alpha-value>)',
        phase2: 'rgb(var(--color-phase2) / <alpha-value>)',
        phase3: 'rgb(var(--color-phase3) / <alpha-value>)',
        phase4: 'rgb(var(--color-phase4) / <alpha-value>)',
        phase5: 'rgb(var(--color-phase5) / <alpha-value>)',
        phase6: 'rgb(var(--color-phase6) / <alpha-value>)',
        phase7: 'rgb(var(--color-phase7) / <alpha-value>)',
        phase8: 'rgb(var(--color-phase8) / <alpha-value>)',
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        border: "var(--border)",
        primary: "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        surface: {
          DEFAULT: "#050B14",
          card: "#0a1120",
          elevated: "#121b2d",
        },
      },
    },
  },
  plugins: [],
};
export default config;
