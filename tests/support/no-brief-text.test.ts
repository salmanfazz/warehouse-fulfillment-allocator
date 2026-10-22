import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

// The project rules say not to quote or point at the challenge text anywhere in the repository,
// so no tracked source, script, migration or document may refer to "the brief". (This file is not
// scanned: it has to contain the phrase to look for it.)
const SCANNED = ['src', 'scripts', 'db', 'docs/setup.md', 'docs/decisions.md'];

describe('repository text', () => {
  it('nothing_refers_to_the_task_brief', () => {
    const files = SCANNED.flatMap((entry) =>
      statSync(entry).isDirectory() ? sourceFiles(entry) : [entry],
    );
    const offenders = files.filter((file) =>
      /\bthe (challenge )?brief\b/i.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
