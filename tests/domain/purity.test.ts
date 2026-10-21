import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { purityViolations } from '../support/purity';

// The domain is pure: it imports only its own files and the shared constants, and nothing in it
// reads the clock, the random generator, the environment, the locale or the machine's time zone.
it('src_domain_is_pure', () => {
  const files = readdirSync('src/domain').filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(purityViolations(readFileSync(`src/domain/${file}`, 'utf8')), file).toEqual([]);
  }
});
