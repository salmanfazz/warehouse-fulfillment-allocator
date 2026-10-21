// Scans domain source code for anything that would make it impure. Comments are ignored.

const ALLOWED_IMPORT = /^(\.\/|@\/config$)/;

const IMPORT_FORMS = [
  /\bfrom\s+['"]([^'"]+)['"]/g, // import ... from 'x' and export ... from 'x'
  /\bimport\s+['"]([^'"]+)['"]/g, // import 'x'
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('x')
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, // require('x')
];

const FORBIDDEN: [string, RegExp][] = [
  ['dynamic import with a computed name', /\bimport\(\s*[^'"\s)]/],
  ['reads the clock (Date.now)', /\bDate\.now\s*\(/],
  ['reads the clock (new Date())', /\bnew Date\(\s*\)/],
  ['uses randomness', /\bMath\.random\s*\(/],
  ['reads the environment', /\bprocess\./],
  ['uses Intl', /\bIntl\./],
  ['uses the locale', /\.toLocale\w*\(/],
  ['reads the time zone', /\.getTimezoneOffset\s*\(/],
  [
    'uses a local-time date getter',
    /\.get(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(/,
  ],
];

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

export function purityViolations(source: string): string[] {
  const code = withoutComments(source);
  const found: string[] = [];
  for (const form of IMPORT_FORMS) {
    for (const match of code.matchAll(form)) {
      if (!ALLOWED_IMPORT.test(match[1] as string)) found.push(`imports ${match[1]}`);
    }
  }
  for (const [label, pattern] of FORBIDDEN) {
    if (pattern.test(code)) found.push(label);
  }
  return found;
}
