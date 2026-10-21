import { describe, expect, it } from 'vitest';
import { cached } from '@/db/cache';

function counting(values: string[] = ['a', 'b', 'c']) {
  let calls = 0;
  return { load: async () => values[calls++ % values.length]!, calls: () => calls };
}

describe('cached', () => {
  it('loads_once_within_the_ttl', async () => {
    let t = 0;
    const src = counting();
    const c = cached(src.load, 1000, () => t);
    expect(await c.get()).toBe('a');
    t = 999;
    expect(await c.get()).toBe('a');
    expect(src.calls()).toBe(1);
  });

  it('reloads_after_the_ttl_and_exactly_at_it', async () => {
    let t = 0;
    const src = counting();
    const c = cached(src.load, 1000, () => t);
    await c.get();
    t = 1000; // age equals the ttl: expired
    expect(await c.get()).toBe('b');
    expect(src.calls()).toBe(2);
  });

  it('concurrent_callers_share_one_load', async () => {
    let calls = 0;
    let release!: (v: string) => void;
    const c = cached(
      () => {
        calls++;
        return new Promise<string>((r) => (release = r));
      },
      1000,
      () => 0,
    );
    const [p1, p2, p3] = [c.get(), c.get(), c.get()];
    release('x');
    expect(await Promise.all([p1, p2, p3])).toEqual(['x', 'x', 'x']);
    expect(calls).toBe(1);
  });

  it('a_failed_load_is_not_cached_and_the_next_call_retries', async () => {
    let calls = 0;
    const c = cached(
      async () => {
        if (calls++ === 0) throw new Error('boom');
        return 'ok';
      },
      1000,
      () => 0,
    );
    await expect(c.get()).rejects.toThrow('boom');
    expect(await c.get()).toBe('ok');
    expect(calls).toBe(2);
  });

  it('clear_forces_a_reload', async () => {
    const src = counting();
    const c = cached(src.load, 1000, () => 0);
    await c.get();
    c.clear();
    expect(await c.get()).toBe('b');
  });

  it('a_load_that_started_before_clear_does_not_repopulate_the_cache', async () => {
    let release!: (v: string) => void;
    let calls = 0;
    const c = cached(
      () => {
        calls++;
        return calls === 1 ? new Promise<string>((r) => (release = r)) : Promise.resolve('fresh');
      },
      1000,
      () => 0,
    );
    const stale = c.get();
    c.clear(); // e.g. the reference data was just reseeded
    release('stale');
    expect(await stale).toBe('stale'); // the caller that asked gets its answer...
    expect(await c.get()).toBe('fresh'); // ...but it was not stored
  });
});
