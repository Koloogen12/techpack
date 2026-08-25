import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'golden',
          include: ['golden/**/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
        },
      },
    ],
  },
});
