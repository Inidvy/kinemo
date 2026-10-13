import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/.
  base: "./",
  build: { target: "es2022" },
  test: { environment: "node" },
} as any);
