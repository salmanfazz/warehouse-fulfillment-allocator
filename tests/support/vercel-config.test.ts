import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('deployment config', () => {
  const vercel = json('vercel.json') as {
    regions?: string[];
    crons?: { path: string; schedule: string }[];
  };
  const pkg = json('package.json') as {
    scripts: Record<string, string>;
    engines?: { node?: string };
  };

  it('runs_in_the_singapore_region', () => {
    expect(vercel.regions).toEqual(['sin1']);
  });

  it('has_one_daily_keep_alive_cron_that_points_at_a_real_route', () => {
    expect(vercel.crons).toHaveLength(1);
    const [cron] = vercel.crons!;
    expect(cron!.path).toBe('/api/cron/keep-alive');
    expect(cron!.schedule).toMatch(/^\d+ \d+ \* \* \*$/); // minute, hour, then every day
    expect(existsSync('src/app/api/cron/keep-alive/route.ts')).toBe(true);
  });

  it('has_the_smoke_and_data_api_scripts', () => {
    expect(pkg.scripts.smoke).toBe('tsx scripts/smoke.ts');
    expect(pkg.scripts['check:data-api']).toBe('tsx scripts/check-data-api.ts');
  });

  it('pins_the_node_major_version_used_locally', () => {
    const major = readFileSync('.nvmrc', 'utf8').trim().split('.')[0];
    expect(pkg.engines?.node).toBe(`${major}.x`);
  });
});
