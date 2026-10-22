import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
};

// There is no DOM or layout test stack, so this guards one mobile bug by reading the stylesheet:
// `.sr-only` is absolutely positioned, and unless the scroll container is its containing block it
// escapes the container's clipping and widens the whole page (the stock table has many of them).
describe('mobile layout', () => {
  it('table_scroll_contains_the_absolutely_positioned_sr_only_text', () => {
    expect(rule('.sr-only')).toMatch(/position:\s*absolute/);
    expect(rule('.table-scroll')).toMatch(/position:\s*relative/);
  });
});
