import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5174, host: "0.0.0.0" },
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false },
});
