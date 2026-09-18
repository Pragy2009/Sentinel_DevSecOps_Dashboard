import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["JetBrains Mono", "Fira Code", "monospace"], sans: ["Inter", "system-ui", "sans-serif"] },
      colors: {
        sn: {
          bg: "#080b12", surface: "#0d1117", border: "#1c2333", muted: "#2d3748",
          text: "#e6edf3", dim: "#7d8590", purple: "#a78bfa", "purple-d": "#7c3aed",
          cyan: "#22d3ee", red: "#f85149", "red-d": "#da3633", green: "#3fb950",
          amber: "#e3b341", blue: "#58a6ff",
        },
      },
      keyframes: {
        "pulse-glow": { "0%,100%": { boxShadow: "0 0 0 0 rgba(167,139,250,0.4)" }, "50%": { boxShadow: "0 0 0 6px rgba(167,139,250,0)" } },
        "scan-slide": { "0%": { transform: "translateY(-100%)" }, "100%": { transform: "translateY(100vh)" } },
        "fade-in": { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "scan-slide": "scan-slide 4s linear infinite",
        "fade-in": "fade-in 0.3s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
