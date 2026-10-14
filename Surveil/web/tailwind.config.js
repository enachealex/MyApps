/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b0f14", 900: "#111821", 800: "#18222d", 700: "#22303d", 600: "#31414f" },
        accent: { DEFAULT: "#38bdf8", dim: "#0ea5e9" },
      },
    },
  },
  plugins: [],
};
