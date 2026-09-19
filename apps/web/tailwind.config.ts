import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1C2740",
        muted: "#8B95A7",
        cloud: "#F4F7FF",
        line: "#E7ECF5",
      },
      boxShadow: {
        phone: "0 30px 80px rgba(80, 110, 200, 0.18)",
      },
    },
  },
  plugins: [],
};

export default config;
