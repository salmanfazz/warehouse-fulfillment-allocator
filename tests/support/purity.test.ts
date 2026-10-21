import { describe, expect, it } from 'vitest';
import { purityViolations } from './purity';

describe('purityViolations', () => {
  const clean =
    "import { PLAN } from '@/config';\nimport type { Day } from './types';\nexport const x = new Date(0).getUTCDay();";

  it('accepts_relative_imports_and_the_config', () => {
    expect(purityViolations(clean)).toEqual([]);
  });

  it('catches_every_import_form_that_leaves_the_domain', () => {
    expect(purityViolations("import x from 'postgres';")).toHaveLength(1);
    expect(purityViolations("import type { Sql } from 'postgres';")).toHaveLength(1);
    expect(purityViolations("export { y } from '@/db/client';")).toHaveLength(1);
    expect(purityViolations("import 'server-only';")).toHaveLength(1);
    expect(purityViolations("const m = await import('next/server');")).toHaveLength(1);
    expect(purityViolations("const m = require('node:fs');")).toHaveLength(1);
    expect(purityViolations('const m = await import(name);')).toHaveLength(1); // not a literal: cannot be checked
  });

  it('catches_sources_of_nondeterminism', () => {
    for (const code of [
      'const t = Date.now();',
      'const t = new Date();',
      'const r = Math.random();',
      'const e = process.env.X;',
      "const f = new Intl.NumberFormat('en');",
      'const s = n.toLocaleString();',
      'const o = d.getTimezoneOffset();',
      'const h = d.getHours();',
      'const day = d.getDay();',
      'const y = d.getFullYear();',
    ]) {
      expect(purityViolations(code), code).toHaveLength(1);
    }
  });

  it('allows_utc_getters_and_dates_built_from_an_argument', () => {
    expect(
      purityViolations('const d = new Date(ms); d.getUTCHours(); d.getUTCDay(); d.getTime();'),
    ).toEqual([]);
  });

  it('ignores_words_in_comments', () => {
    expect(
      purityViolations(
        "// Date.now() and process.env are not used here\n/* import x from 'postgres' */\nconst a = 1;",
      ),
    ).toEqual([]);
  });
});
