import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Dev-only harness config. Serves the REAL client (Phaser scene + DOM HUD) from
// dev/harness/index.html against the in-browser mock server, with no Devvit
// runtime. Completely separate from vite.config.ts — the production devvit build
// never sees any of this, and the harness directory is not part of dist/.
//
// Run with: npm run harness  →  http://localhost:5199

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The harness index.html is the app entry.
  root: resolve(root, 'dev/harness'),
  // Serve /sprites, /icons, /fonts from the repo's public/ as-is.
  publicDir: resolve(root, 'public'),
  resolve: {
    alias: {
      // The one seam: the real client imports '@devvit/web/client'; the harness
      // swaps in a browser stub (context, realtime bus, toasts, no-ops).
      '@devvit/web/client': resolve(root, 'dev/harness/mock-devvit-client.ts'),
    },
  },
  server: {
    port: 5199,
    strictPort: true,
    open: false,
  },
});
