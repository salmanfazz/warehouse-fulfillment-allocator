import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEtaStats, etaFor, median } from '@/domain/eta';
import type { Day, DeliveryRecord, EtaStats } from '@/domain/types';
import { loadDeliveryRecords } from './helpers';

type Fixture = Record<
  string,
  {
    warehouseMedian: number;
    count: number;
    buckets: Record<string, { n: number; bucketMedian: number | null; estimate: number }>;
  }
>;
const fixture = JSON.parse(readFileSync('tests/fixtures/eta-table.json', 'utf8')) as Fixture;
const ids = Object.keys(fixture);

const rec = (
  warehouseId: string,
  day: Day,
  startTime: string,
  durationMin: number,
): DeliveryRecord => ({
  warehouseId,
  day,
  startTime,
  durationMin,
});

describe('median', () => {
  it('median_odd_even_single_and_unsorted', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('median_of_nothing_throws', () => {
    expect(() => median([])).toThrow(RangeError);
  });

  it('median_does_not_reorder_its_input', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('buildEtaStats', () => {
  it('matches_the_eta_fixture', () => {
    const stats = buildEtaStats(loadDeliveryRecords(), ids);
    expect(Object.keys(stats).sort()).toEqual(ids.sort());
    for (const id of ids) {
      const want = fixture[id]!;
      const got = stats[id]!;
      expect(got.count, id).toBe(want.count);
      expect(got.warehouseMedian, id).toBe(want.warehouseMedian);
      for (const bucket of ['peak', 'off_peak', 'weekend'] as const) {
        expect(got.buckets[bucket].n, `${id} ${bucket} n`).toBe(want.buckets[bucket]!.n);
        expect(got.buckets[bucket].bucketMedian, `${id} ${bucket} median`).toBe(
          want.buckets[bucket]!.bucketMedian,
        );
        expect(got.buckets[bucket].estimate, `${id} ${bucket} estimate`).toBeCloseTo(
          want.buckets[bucket]!.estimate,
          9,
        );
      }
    }
  });

  it('empty_bucket_falls_back_to_the_warehouse_median', () => {
    const stats = buildEtaStats(
      [rec('WX', 'Mon', '08:00', 30), rec('WX', 'Mon', '12:00', 50)],
      ['WX'],
    );
    expect(stats.WX!.buckets.weekend).toEqual({ n: 0, bucketMedian: null, estimate: 40 });
  });

  it('shrinkage_formula_when_the_bucket_agrees_with_the_warehouse', () => {
    const stats = buildEtaStats(
      [rec('WX', 'Mon', '08:00', 40), rec('WX', 'Tue', '08:00', 50), rec('WX', 'Wed', '08:00', 60)],
      ['WX'],
    );
    expect(stats.WX!.buckets.peak.estimate).toBe(50); // (3*50 + 2*50) / 5
  });

  it('shrinkage_pulls_a_thin_bucket_towards_the_warehouse_median', () => {
    const stats = buildEtaStats(
      [
        rec('WX', 'Mon', '08:00', 100), // the only peak record
        rec('WX', 'Mon', '12:00', 20),
        rec('WX', 'Mon', '13:00', 30),
        rec('WX', 'Tue', '12:00', 40),
      ],
      ['WX'],
    );
    expect(stats.WX!.warehouseMedian).toBe(35);
    expect(stats.WX!.buckets.peak.estimate).toBeCloseTo((1 * 100 + 2 * 35) / 3, 12);
    expect(stats.WX!.buckets.off_peak.estimate).toBeCloseTo((3 * 30 + 2 * 35) / 5, 12);
  });

  it('record_start_time_with_seconds_buckets_like_without', () => {
    const a = buildEtaStats([rec('WX', 'Mon', '09:29', 10), rec('WX', 'Mon', '09:30', 90)], ['WX']);
    const b = buildEtaStats(
      [rec('WX', 'Mon', '09:29:59', 10), rec('WX', 'Mon', '09:30:00', 90)],
      ['WX'],
    );
    expect(b).toEqual(a);
    expect(a.WX!.buckets.peak.n).toBe(1);
    expect(a.WX!.buckets.off_peak.n).toBe(1);
  });

  it('records_of_other_warehouses_are_ignored', () => {
    const stats = buildEtaStats(
      [rec('WX', 'Mon', '08:00', 10), rec('WY', 'Mon', '08:00', 999)],
      ['WX'],
    );
    expect(Object.keys(stats)).toEqual(['WX']);
    expect(stats.WX!.count).toBe(1);
  });

  it('warehouse_without_records_throws_and_names_it', () => {
    expect(() => buildEtaStats([rec('WX', 'Mon', '08:00', 10)], ['WX', 'W09'])).toThrow(/W09/);
  });
});

describe('etaFor', () => {
  const stats: EtaStats = buildEtaStats(
    [
      rec('WX', 'Mon', '08:00', 100),
      rec('WX', 'Mon', '12:00', 20),
      rec('WX', 'Mon', '13:00', 30),
      rec('WX', 'Tue', '12:00', 40),
    ],
    ['WX'],
  );

  it('eta_for_returns_the_unrounded_estimate', () => {
    expect(etaFor(stats, 'WX', 'peak')).toBe(stats.WX!.buckets.peak.estimate);
    expect(Number.isInteger(etaFor(stats, 'WX', 'peak'))).toBe(false);
  });

  it('eta_for_unknown_warehouse_throws', () => {
    expect(() => etaFor(stats, 'W99', 'peak')).toThrow(/W99/);
  });
});
