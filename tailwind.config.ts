import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Neutral slate-forward palette; tweak to taste.
        hub: {
          bg: "#0b0f19",
          panel: "#141a29",
          panel2: "#1b2334",
          border: "#26304a",
          accent: "#6366f1",
          accent2: "#8b5cf6",
          muted: "#8b95ad",
        },
      },
    },
  },
  plugins: [],
};

export default config;
