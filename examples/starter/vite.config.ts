import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// /api goes to the records server (`npm run dev` starts it); VITE_DATA=memory skips it.
export default defineConfig({
  plugins: [react()],
  server: { watch: { ignored: ["**/docs/**", "**/data/**", "**/server/**"] }, proxy: { "/api": "http://127.0.0.1:8787" } },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"] },
});
