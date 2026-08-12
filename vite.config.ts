import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    css: { include: [/styles\.css/u] },
    environment: "jsdom",
    setupFiles: "./frontend/test/setup.ts",
  },
});
