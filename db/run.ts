import { createSql } from '../src/db/client';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';

// Usage: tsx db/run.ts migrate | seed   (reads DATABASE_URL)
async function main() {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = createSql(url, { max: 1 });
  try {
    if (command === 'migrate') {
      const applied = await migrate(sql);
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No migrations to apply');
    } else if (command === 'seed') {
      await seed(sql);
      console.log('Seed data is in place');
    } else {
      throw new Error('Usage: tsx db/run.ts migrate | seed');
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
