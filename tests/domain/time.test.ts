import { describe, expect, it } from 'vitest';
import {
  bucketOf,
  formatWib,
  isValidOrderedAt,
  minutesOf,
  parseOrderedAt,
  toWib,
} from '@/domain/time';

const wib = (iso: string) => toWib(parseOrderedAt(iso));

describe('toWib', () => {
  it('utc_01_00_is_monday_08_00_wib_peak', () => {
    expect(wib('2026-10-19T01:00:00Z')).toEqual({ day: 'Mon', minutes: 480, bucket: 'peak' });
  });

  it('offset_and_z_forms_give_the_same_instant', () => {
    const a = parseOrderedAt('2026-10-19T08:00:00+07:00');
    expect(parseOrderedAt('2026-10-19T01:00:00Z')).toBe(a);
    expect(parseOrderedAt('2026-10-18T20:00:00-05:00')).toBe(a);
  });

  it('bucket_boundaries', () => {
    const at = (time: string) => wib(`2026-10-19T${time}:00+07:00`).bucket; // a Monday
    expect(at('06:59')).toBe('off_peak');
    expect(at('07:00')).toBe('peak');
    expect(at('09:29')).toBe('peak');
    expect(at('09:30')).toBe('off_peak');
    expect(at('15:59')).toBe('off_peak');
    expect(at('16:00')).toBe('peak');
    expect(at('18:59')).toBe('peak');
    expect(at('19:00')).toBe('off_peak');
  });

  it('seconds_are_truncated', () => {
    expect(wib('2026-10-19T09:29:59+07:00').bucket).toBe('peak');
    expect(wib('2026-10-19T09:30:00+07:00').bucket).toBe('off_peak');
    expect(wib('2026-10-19T18:59:59+07:00').bucket).toBe('peak');
  });

  it('saturday_and_sunday_are_weekend_at_any_time', () => {
    for (const date of ['2026-10-24', '2026-10-25']) {
      for (const time of ['00:00', '08:00', '12:00', '17:30', '23:59']) {
        expect(wib(`${date}T${time}:00+07:00`).bucket).toBe('weekend');
      }
    }
  });

  it('midnight_crossing_moves_the_day', () => {
    expect(wib('2026-10-18T17:00:00Z')).toEqual({ day: 'Mon', minutes: 0, bucket: 'off_peak' });
    expect(wib('2026-10-23T17:00:00Z')).toEqual({ day: 'Sat', minutes: 0, bucket: 'weekend' });
    expect(wib('2026-10-25T16:59:00Z').day).toBe('Sun');
  });

  it('fractional_seconds_are_accepted_and_dropped', () => {
    expect(wib('2026-10-19T08:00:00.789+07:00')).toEqual(wib('2026-10-19T08:00:00+07:00'));
  });

  it('seconds_may_be_left_out', () => {
    expect(parseOrderedAt('2026-10-19T08:00+07:00')).toBe(
      parseOrderedAt('2026-10-19T08:00:00+07:00'),
    );
  });
});

describe('bucketOf', () => {
  it('weekdays_use_the_peak_windows', () => {
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const) {
      expect(bucketOf(day, 8 * 60)).toBe('peak');
      expect(bucketOf(day, 12 * 60)).toBe('off_peak');
    }
    expect(bucketOf('Sat', 8 * 60)).toBe('weekend');
    expect(bucketOf('Sun', 17 * 60)).toBe('weekend');
  });
});

describe('formatWib', () => {
  it('adds_plus_07_00_and_drops_milliseconds', () => {
    expect(formatWib(parseOrderedAt('2026-10-19T01:00:00Z'))).toBe('2026-10-19T08:00:00+07:00');
    expect(formatWib(parseOrderedAt('2026-10-19T01:00:00.999Z'))).toBe('2026-10-19T08:00:00+07:00');
  });

  it('moves_to_the_next_wib_day_when_utc_is_late', () => {
    expect(formatWib(parseOrderedAt('2026-12-31T20:30:05Z'))).toBe('2027-01-01T03:30:05+07:00');
  });
});

describe('minutesOf', () => {
  it('minutes_of_accepts_hh_mm_and_hh_mm_ss', () => {
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('08:00')).toBe(480);
    expect(minutesOf('08:00:00')).toBe(480);
    expect(minutesOf('09:29:59')).toBe(569);
    expect(minutesOf('23:59')).toBe(1439);
  });

  it('rejects_anything_else', () => {
    for (const bad of ['', '8:00', '24:00', '12:60', 'noon', '12:00:00:00']) {
      expect(() => minutesOf(bad)).toThrow(RangeError);
    }
  });
});

describe('orderedAt validation', () => {
  const valid = [
    '2026-10-19T08:00:00+07:00',
    '2026-10-19T01:00:00Z',
    '2026-10-19T08:00+07:00',
    '2026-10-19T08:00:00.123Z',
    '2026-10-18T20:00:00-05:00',
    '2028-02-29T00:00:00Z',
  ];
  const invalid = [
    '2026-10-19T08:00:00', // no offset
    '2026-10-19', // date only
    '2026-02-30T00:00:00Z', // impossible date
    '2027-02-29T00:00:00Z', // not a leap year
    '2026-13-01T00:00:00Z',
    '2026-00-10T00:00:00Z',
    '2026-10-00T00:00:00Z',
    '2026-10-19T24:00:00Z',
    '2026-10-19T12:60:00Z',
    '2026-10-19T12:00:60Z',
    '2026-10-19T08:00:00+0700', // offset without colon
    '2026-10-19T08:00:00+24:00',
    '2026-10-19T08:00:00+07:60',
    '2026-10-19 08:00:00Z',
    ' 2026-10-19T08:00:00Z',
    'yesterday',
    '',
  ];

  it('accepts_valid_forms', () => {
    for (const iso of valid) {
      expect(isValidOrderedAt(iso), iso).toBe(true);
      expect(() => parseOrderedAt(iso), iso).not.toThrow();
    }
  });

  it('rejects_invalid_forms_with_a_range_error', () => {
    for (const iso of invalid) {
      expect(() => parseOrderedAt(iso), iso).toThrow(RangeError);
    }
  });

  it('is_valid_ordered_at_agrees_with_parse_on_every_accepted_and_rejected_input', () => {
    for (const iso of [...valid, ...invalid]) {
      let parses = true;
      try {
        parseOrderedAt(iso);
      } catch {
        parses = false;
      }
      expect(isValidOrderedAt(iso), iso).toBe(parses);
    }
  });
});
