import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Retinted to match the PSU seal (sky-blue field, gold crown/stars) --
        // previously an arbitrary navy unrelated to the university's actual
        // colors. #0f6ba8 keeps ~5.7:1 contrast against white (header/button
        // text), close to the seal's blue but deep enough to stay readable.
        psu: { DEFAULT: "#0f6ba8", light: "#e3f1fa", dark: "#0a4e7d" },
        "psu-gold": { DEFAULT: "#fdb913", dark: "#c98e00" },
      },
    },
  },
  plugins: [],
};
export default config;
