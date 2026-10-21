import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidOrderedAt } from '@/domain/time';
import { currentWibInput, orderedAtFromInput } from '@/app/ui/time';

afterEach(() => vi.unstubAllEnvs());

const AT = Date.parse('2026-10-21T03:15:42Z'); // 10:15:42 in WIB

describe('currentWibInput', () => {
  it('current_wib_input_is_the_wib_wall_clock', () => {
    expect(currentWibInput(AT)).toBe('2026-10-21T10:15');
  });

  it('gives_the_same_answer_whatever_zone_the_browser_is_in', () => {
    for (const zone of [
      'UTC',
      'Asia/Tokyo',
      'America/Los_Angeles',
      'Asia/Kolkata',
      'Pacific/Auckland',
    ]) {
      vi.stubEnv('TZ', zone);
      expect(currentWibInput(AT), zone).toBe('2026-10-21T10:15');
    }
  });

  it('midnight_and_month_end', () => {
    expect(currentWibInput(Date.parse('2026-12-31T17:00:00Z'))).toBe('2027-01-01T00:00');
    expect(currentWibInput(Date.parse('2026-02-28T16:59:59Z'))).toBe('2026-02-28T23:59');
    expect(currentWibInput(Date.parse('2028-02-28T17:00:00Z'))).toBe('2028-02-29T00:00');
  });

  it('defaults_to_now', () => {
    const before = Date.now();
    const value = currentWibInput();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(Date.now() - before).toBeLessThan(1000);
  });
});

describe('orderedAtFromInput', () => {
  it('adds_the_wib_offset_to_a_datetime_local_value', () => {
    expect(orderedAtFromInput('2026-10-21T10:15')).toBe('2026-10-21T10:15:00+07:00');
  });

  it('adds_the_offset_to_a_value_with_seconds_too', () => {
    expect(orderedAtFromInput('2026-10-21T10:15:30')).toBe('2026-10-21T10:15:30+07:00');
  });

  it('round_trip_through_the_server_validator', () => {
    for (const ms of [AT, Date.parse('2026-12-31T17:00:00Z'), Date.parse('2028-02-28T17:00:00Z')]) {
      const sent = orderedAtFromInput(currentWibInput(ms));
      expect(isValidOrderedAt(sent!), sent).toBe(true);
    }
  });

  it('empty_or_blank_means_now', () => {
    expect(orderedAtFromInput('')).toBeUndefined();
    expect(orderedAtFromInput('   ')).toBeUndefined();
  });

  it('keeps_a_value_that_already_has_an_offset_for_the_server_to_judge', () => {
    expect(orderedAtFromInput('2026-10-21T10:15:00+07:00')).toBe('2026-10-21T10:15:00+07:00');
    expect(orderedAtFromInput('2026-10-21T03:15:00Z')).toBe('2026-10-21T03:15:00Z');
    expect(orderedAtFromInput('soon')).toBe('soon');
  });

  it('the_wib_default_means_the_same_instant_as_the_domain_says', () => {
    const sent = orderedAtFromInput(currentWibInput(AT))!;
    expect(Date.parse(sent)).toBe(AT - 42_000); // seconds are dropped from the field
  });
});
