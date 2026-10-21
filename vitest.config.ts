import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/{api,support,domain}/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'db', include: ['tests/db/**/*.test.ts'], fileParallelism: false },
      },
    ],
  },
});
