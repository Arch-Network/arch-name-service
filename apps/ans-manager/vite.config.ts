import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

/**
 * A stamp the running page can report.
 *
 * Without one, "the user is on an old bundle" and "the fix does not work" look
 * identical in a bug report — which cost a whole debugging round after a deploy
 * that was actually correct. The page prints this on boot and carries it in
 * error details, so a support conversation starts from the build the user is
 * actually running.
 */
function buildStamp(): string {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // Building outside a git checkout; the timestamp alone still identifies it.
  }
  return `${commit} ${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`;
}

export default defineConfig({
  // Kit bip322 stack needs crypto/stream/events. Buffer stays on the existing
  // `buffer/` alias + early polyfills.ts — including Buffer in the plugin
  // rewrites imports to `vite-plugin-node-polyfills/shims/buffer`, which fails
  // to resolve from packages/ans-sdk's nested arch-sdk copy.
  plugins: [
    react(),
    nodePolyfills({
      exclude: ["buffer"],
      globals: {
        Buffer: false,
        global: true,
        process: true,
      },
    }),
  ],
  server: { port: 5174 },
  resolve: {
    alias: {
      buffer: "buffer/",
    },
    dedupe: ["react", "react-dom", "@omnisat/lasereyes", "buffer", "@saturnbtcio/arch-sdk"],
  },
  optimizeDeps: {
    include: ["buffer", "@arch-network/wallet-connect-kit", "@omnisat/lasereyes"],
  },
  define: {
    global: "globalThis",
    __ANS_BUILD__: JSON.stringify(buildStamp()),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
  },
});
