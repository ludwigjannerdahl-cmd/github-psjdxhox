import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        alabaster: "#F9FAFB",
        charcoal: "#1C1917",
        midnight: "#0F172A",
        sage: {
          DEFAULT: "#3F6212",
          light: "#ECFCCB", // 20% opacity sage
          text: "#365314",
        },
        clay: {
          DEFAULT: "#BE123C",
          light: "#FFE4E6",
          text: "#881337",
        },
      },
      fontFamily: {
        sans: ['"Inter Tight"', 'sans-serif'], // Premium Grotesque feel
      },
      boxShadow: {
        'luxury': '0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.02)',
        'lift': '0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.025)',
      }
    },
  },
  plugins: [],
};
export default config;