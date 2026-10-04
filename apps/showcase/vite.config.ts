import { defineConfig } from "vite";

// AGENTS.md: a random dev-server port, so parallel worktrees never collide.
export default defineConfig({
  server: { port: 20000 + Math.floor(Math.random() * 20000), strictPort: false },
  // tsc -b emits into dist/ too; keep the app bundle in its own folder.
  build: { outDir: "dist/app" },
});
