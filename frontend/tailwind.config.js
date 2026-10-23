/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        field: {
          DEFAULT: "#1F4B3F", // deep field-green — primary, trust
          light: "#2E6B58",
          dark: "#153A30",
        },
        wheat: {
          DEFAULT: "#D9A441", // ripe-wheat gold — tokens, status, CTAs
          light: "#F0C878",
          dark: "#B5822A",
        },
        soil: {
          DEFAULT: "#5C4630", // text / secondary
          light: "#8A7358",
        },
        sky: {
          DEFAULT: "#2F6690", // reserved only for "in progress" states
        },
        paper: "#FAF9F4", // warm background, not cream/terracotta
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
