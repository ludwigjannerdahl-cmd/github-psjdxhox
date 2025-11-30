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
        // The "World Beneath" Palette
        sage: {
          light: '#e6f4f1', // Soft Nordic Green background
          text: '#2d5a52',  // Deep Forest Green text
        },
        charcoal: '#1e293b',
        ice: '#f0f9ff',
      },
    },
  },
  plugins: [],
};
export default config;