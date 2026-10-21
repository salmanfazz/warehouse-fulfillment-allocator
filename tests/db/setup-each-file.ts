import { afterAll, beforeAll } from 'vitest';
import { restoreBaseline, testSql } from './helpers';

// All database test files share one database and run in no fixed order. Every file starts from,
// and leaves behind, the baseline, so one file's changes can never reach another.
const sql = testSql();

beforeAll(() => restoreBaseline(sql));
afterAll(async () => {
  try {
    await restoreBaseline(sql);
  } finally {
    await sql.end();
  }
});
