import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

// Inside the workspace, @yadad/* packages resolve to their TypeScript source
// (the "@yadad/source" export condition), so tests never run against stale builds.
const source = "@yadad/source";

export default defineConfig({
  resolve: { conditions: [source, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] } },
  test: {
    include: ["{packages/*,testing,apps/*}/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", ".worktrees/**"],
    passWithNoTests: true,
  },
});
