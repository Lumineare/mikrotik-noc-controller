/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        noc: {
          bg: "#f8fafc",
          surface: "#f1f5f9",
          card: "#ffffff",
          hover: "#e2e8f0",
          border: "#cbd5e1",
          borderLight: "#e2e8f0",
          cyan: "#0284c7",
          emerald: "#059669",
          amber: "#d97706",
          rose: "#e11d48",
          violet: "#6366f1",
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Code"', 'Consolas', 'ui-monospace', 'monospace'],
        sans: ['Inter', '"Segoe UI Variable"', '"Segoe UI"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
