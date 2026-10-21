import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { buildReference, clearReferenceCache, getReference } from '@/db/reference';
import { testSql } from './helpers';

const sql = testSql();
afterAll(() => sql.end());

type EtaFixture = Record<string, { buckets: Record<string, { estimate: number }> }>;
const fixture = JSON.parse(readFileSync('tests/fixtures/eta-table.json', 'utf8')) as EtaFixture;

describe('getReference', () => {
  it('loads_catalogue_warehouses_and_eta', async () => {
    clearReferenceCache(sql);
    const ref = await getReference(sql);
    expect(ref.products.map((p) => p.id)).toEqual(['P001', 'P002', 'P003', 'P004', 'P005']);
    expect(ref.warehouses.map((w) => w.id)).toEqual([
      'W01',
      'W02',
      'W03',
      'W04',
      'W05',
      'W06',
      'W07',
      'W08',
    ]);
    expect(ref.products[1]).toEqual({
      id: 'P002',
      name: 'Vaccine - Hepatitis B (10-dose vial)',
      category: 'Pharmaceutical',
      requiresColdChain: true,
    });
    for (const [id, want] of Object.entries(fixture)) {
      for (const bucket of ['peak', 'off_peak', 'weekend'] as const) {
        expect(ref.eta[id]!.buckets[bucket].estimate, `${id} ${bucket}`).toBeCloseTo(
          want.buckets[bucket]!.estimate,
          9,
        );
      }
    }
  });

  it('second_call_returns_the_cached_object', async () => {
    clearReferenceCache(sql);
    const first = await getReference(sql);
    expect(await getReference(sql)).toBe(first);
  });

  it('clear_forces_a_reload', async () => {
    const first = await getReference(sql);
    clearReferenceCache(sql);
    const second = await getReference(sql);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('clear_without_a_client_clears_all', async () => {
    const first = await getReference(sql);
    clearReferenceCache();
    expect(await getReference(sql)).not.toBe(first);
  });

  it('concurrent_first_calls_share_one_load', async () => {
    clearReferenceCache(sql);
    const [a, b, c] = await Promise.all([getReference(sql), getReference(sql), getReference(sql)]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe('buildReference', () => {
  const warehouse = {
    id: 'W09',
    city: 'X',
    distance_km: 3,
    has_cold_storage: false,
    has_refrigerated_vehicle: false,
  };
  const product = { id: 'P9', name: 'x', category: 'x', requires_cold_chain: false };
  const delivery = {
    id: 'D1',
    warehouse_id: 'W09',
    day: 'Mon',
    start_time: '08:00:00',
    duration_min: 30,
  };

  it('builds_eta_from_rows', () => {
    const ref = buildReference({
      products: [product],
      warehouses: [warehouse],
      deliveries: [delivery],
    });
    expect(ref.eta.W09!.buckets.peak.estimate).toBe(30);
  });

  it('a_warehouse_without_delivery_history_is_an_error', () => {
    expect(() =>
      buildReference({ products: [product], warehouses: [warehouse], deliveries: [] }),
    ).toThrow(/W09/);
  });

  it('a_string_distance_is_a_type_error', () => {
    const bad = { ...warehouse, distance_km: '3' };
    expect(() =>
      buildReference({ products: [product], warehouses: [bad], deliveries: [delivery] }),
    ).toThrow(TypeError);
  });
});
