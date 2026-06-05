import { defineConfig } from "vitest/config";
import path from "node:path";

// Tests run in a Node environment against the pure-logic modules in lib/.
// The "@/..." alias mirrors tsconfig so tests import the same way the app does.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
