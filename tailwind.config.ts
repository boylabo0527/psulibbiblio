import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        psu: { DEFAULT: "#1f4e79", light: "#e8f0fa", dark: "#163d61" },
      },
    },
  },
  plugins: [],
};
export default config;
