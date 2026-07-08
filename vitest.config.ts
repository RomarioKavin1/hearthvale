import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/shared/**/*.test.ts',
      'src/server/**/*.test.ts',
      // Pure client helpers (e.g. seeded terrain in art/render.ts) that import
      // only type-only phaser symbols and are safe to run under node.
      'src/client/art/**/*.test.ts',
    ],
  },
});
