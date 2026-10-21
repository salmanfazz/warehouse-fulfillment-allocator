import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest does not read .env.local on its own; the database tests need TEST_DATABASE_URL.
// Variables already set in the shell win.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

// Keep the real DATABASE_URL out of the test process: the safety check reads it from
// GUARD_APP_DATABASE_URL, and DATABASE_URL itself now points at the test database (or is
// removed). A test that reaches getSql() without a mock then cannot touch the real database.
process.env.GUARD_APP_DATABASE_URL = process.env.DATABASE_URL ?? '';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;

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
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          fileParallelism: false,
          globalSetup: ['tests/db/global-setup.ts'],
        },
      },
    ],
  },
});
