import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react],
  server: {
    proxy: {
      "/__loom": {
        target: "http://127.0.0.1:17633",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__loom/, ""),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
