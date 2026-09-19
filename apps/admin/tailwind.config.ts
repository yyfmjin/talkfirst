import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16213A",
        muted: "#6B7690",
        line: "#E6EAF3",
      },
    },
  },
  plugins: [],
};

export default config;
