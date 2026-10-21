import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The domain is pure: it may import its own files and the shared constants, nothing else.
it('src_domain_imports_only_itself_and_config', () => {
  const files = readdirSync('src/domain').filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const source = readFileSync(`src/domain/${file}`, 'utf8');
    const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const specifier of specifiers) {
      expect(
        specifier.startsWith('./') || specifier === '@/config',
        `${file} imports ${specifier}`,
      ).toBe(true);
    }
  }
});
