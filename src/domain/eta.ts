import { ETA } from '@/config';
import { bucketOf, minutesOf } from './time';
import type { Bucket, BucketStats, DeliveryRecord, EtaStats, WarehouseEta } from './types';

const BUCKETS: Bucket[] = ['peak', 'off_peak', 'weekend'];

// Middle value; with an even count, the mean of the two middle values.
export function median(values: number[]): number {
  if (values.length === 0) throw new RangeError('Cannot take the median of no values');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

// Per warehouse and time bucket: the bucket median, pulled towards the warehouse's overall
// median when the bucket has few records. With no records in the bucket the warehouse median
// is used as is. Full precision; rounding happens only when the answer is shown.
function bucketStats(durations: number[], warehouseMedian: number): BucketStats {
  const n = durations.length;
  if (n === 0) return { n, bucketMedian: null, estimate: warehouseMedian };
  const bucketMedian = median(durations);
  const estimate = (n * bucketMedian + ETA.shrinkage * warehouseMedian) / (n + ETA.shrinkage);
  return { n, bucketMedian, estimate };
}

export function buildEtaStats(records: DeliveryRecord[], warehouseIds: string[]): EtaStats {
  const stats: EtaStats = {};
  for (const id of warehouseIds) {
    const own = records
      .filter((r) => r.warehouseId === id)
      .map((r) => ({
        bucket: bucketOf(r.day, minutesOf(r.startTime)),
        durationMin: r.durationMin,
      }));
    if (own.length === 0) throw new Error(`No delivery history for ${id}`);

    const warehouseMedian = median(own.map((r) => r.durationMin));
    const buckets = {} as Record<Bucket, BucketStats>;
    for (const bucket of BUCKETS) {
      const durations = own.filter((r) => r.bucket === bucket).map((r) => r.durationMin);
      buckets[bucket] = bucketStats(durations, warehouseMedian);
    }
    const entry: WarehouseEta = { warehouseMedian, count: own.length, buckets };
    stats[id] = entry;
  }
  return stats;
}

export function etaFor(stats: EtaStats, warehouseId: string, bucket: Bucket): number {
  const entry = stats[warehouseId];
  if (!entry) throw new Error(`No delivery time estimate for ${warehouseId}`);
  return entry.buckets[bucket].estimate;
}
