import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'migrations/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      // Per ADR-014: ≥80% lines/functions/statements, ≥75% branches
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    testTimeout: 60000, // 60s for Testcontainers setup
  },
});
